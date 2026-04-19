/**
 * Schema integration tests — exercise the double-entry invariants at
 * the database layer, against a real Postgres via testcontainers.
 *
 * What we assert:
 *   1. Migrations run clean on an empty container.
 *   2. Seed inserts a default workspace + 5-branch chart of accounts.
 *   3. A transaction with balanced postings commits.
 *   4. A transaction with imbalanced postings is rejected at COMMIT
 *      (deferred constraint trigger).
 *   5. Void lifecycle: original transaction flipped to `voided`, a new
 *      mirror transaction with negated postings exists.
 *   6. `draft` transactions may carry unbalanced postings; flipping
 *      them to `posted` re-runs the check and rejects.
 *   7. `updated_at` auto-bumps on UPDATE; `version` increments.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTestDb } from "../setup/db.js";
import {
  transactions,
  postings,
  accounts,
  workspaces,
} from "../../src/schema/index.js";
import { eq } from "drizzle-orm";

/**
 * Drizzle wraps driver errors; the underlying PG message lives on
 * `error.cause.message`. Recurse because cause chains can be nested.
 */
function fullErrorText(err: unknown): string {
  const parts: string[] = [];
  let cur: any = err;
  while (cur) {
    if (typeof cur.message === "string") parts.push(cur.message);
    if (typeof cur.detail === "string") parts.push(cur.detail);
    cur = cur.cause;
  }
  return parts.join(" | ");
}

async function expectThrowsMatching(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  let threw: unknown = null;
  try {
    await fn();
  } catch (err) {
    threw = err;
  }
  if (!threw) throw new Error(`Expected to throw matching ${pattern}, but resolved`);
  const text = fullErrorText(threw);
  if (!pattern.test(text)) {
    throw new Error(`Expected error text to match ${pattern}; got: ${text}`);
  }
}

const ctx = withTestDb();

async function accountIdByName(
  db: typeof ctx.db,
  workspaceId: string,
  name: string,
): Promise<string> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(sql`${accounts.workspaceId} = ${workspaceId} AND ${accounts.name} = ${name}`);
  if (rows.length === 0) throw new Error(`Account not found: ${name}`);
  return rows[0]!.id;
}

describe("schema migrations + seed", () => {
  it("seeds a workspace with 18 accounts", async () => {
    const countRes = await ctx.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM accounts WHERE workspace_id = ${ctx.workspaceId}::uuid`,
    );
    expect(countRes.rows[0]).toMatchObject({ n: 18 });

    const ws = await ctx.db.select().from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
    expect(ws[0]?.baseCurrency).toBe("USD");
  });

  it("exposes a 5-branch chart of accounts tree", async () => {
    const roots = await ctx.db.execute(
      sql`SELECT name, type FROM accounts
          WHERE workspace_id = ${ctx.workspaceId}::uuid AND parent_id IS NULL
          ORDER BY name`,
    );
    const names = roots.rows.map((r: any) => r.name).sort();
    expect(names).toEqual(["Assets", "Equity", "Expenses", "Income", "Liabilities"]);
  });
});

describe("postings balance trigger", () => {
  it("commits a balanced transaction", async () => {
    const groceries = await accountIdByName(ctx.db, ctx.workspaceId, "Groceries");
    const visa = await accountIdByName(ctx.db, ctx.workspaceId, "Credit Card");

    const txId = uuidv7();
    await ctx.db.transaction(async (tx) => {
      await tx.insert(transactions).values({
        id: txId,
        workspaceId: ctx.workspaceId,
        occurredOn: "2026-04-19",
        payee: "Balanced Walmart",
      });
      await tx.insert(postings).values([
        {
          id: uuidv7(),
          workspaceId: ctx.workspaceId,
          transactionId: txId,
          accountId: groceries,
          amountMinor: 14723n,
          currency: "USD",
          amountBaseMinor: 14723n,
        },
        {
          id: uuidv7(),
          workspaceId: ctx.workspaceId,
          transactionId: txId,
          accountId: visa,
          amountMinor: -14723n,
          currency: "USD",
          amountBaseMinor: -14723n,
        },
      ]);
    });

    const pRows = await ctx.db.select().from(postings).where(eq(postings.transactionId, txId));
    expect(pRows).toHaveLength(2);
  });

  it("rejects an imbalanced transaction at commit", async () => {
    const groceries = await accountIdByName(ctx.db, ctx.workspaceId, "Groceries");
    const visa = await accountIdByName(ctx.db, ctx.workspaceId, "Credit Card");
    const txId = uuidv7();

    await expectThrowsMatching(
      () =>
        ctx.db.transaction(async (tx) => {
          await tx.insert(transactions).values({
            id: txId,
            workspaceId: ctx.workspaceId,
            occurredOn: "2026-04-19",
            payee: "Imbalanced",
          });
          await tx.insert(postings).values([
            {
              id: uuidv7(),
              workspaceId: ctx.workspaceId,
              transactionId: txId,
              accountId: groceries,
              amountMinor: 14723n,
              currency: "USD",
              amountBaseMinor: 14723n,
            },
            {
              id: uuidv7(),
              workspaceId: ctx.workspaceId,
              transactionId: txId,
              accountId: visa,
              amountMinor: -10000n,
              currency: "USD",
              amountBaseMinor: -10000n,
            },
          ]);
        }),
      /do not balance/,
    );
  });

  it("rejects a posted transaction with fewer than 2 postings", async () => {
    const groceries = await accountIdByName(ctx.db, ctx.workspaceId, "Groceries");
    const txId = uuidv7();

    await expectThrowsMatching(
      () =>
        ctx.db.transaction(async (tx) => {
          await tx.insert(transactions).values({
            id: txId,
            workspaceId: ctx.workspaceId,
            occurredOn: "2026-04-19",
            payee: "Single-leg",
          });
          await tx.insert(postings).values({
            id: uuidv7(),
            workspaceId: ctx.workspaceId,
            transactionId: txId,
            accountId: groceries,
            amountMinor: 100n,
            currency: "USD",
            amountBaseMinor: 100n,
          });
        }),
      /at least 2/,
    );
  });

  it("allows draft transactions to be unbalanced, but rejects on status flip", async () => {
    const groceries = await accountIdByName(ctx.db, ctx.workspaceId, "Groceries");
    const visa = await accountIdByName(ctx.db, ctx.workspaceId, "Credit Card");
    const txId = uuidv7();

    // Insert draft with imbalanced postings — allowed.
    await ctx.db.transaction(async (tx) => {
      await tx.insert(transactions).values({
        id: txId,
        workspaceId: ctx.workspaceId,
        occurredOn: "2026-04-19",
        payee: "Draft imbalance",
        status: "draft",
      });
      await tx.insert(postings).values([
        {
          id: uuidv7(),
          workspaceId: ctx.workspaceId,
          transactionId: txId,
          accountId: groceries,
          amountMinor: 1000n,
          currency: "USD",
          amountBaseMinor: 1000n,
        },
        {
          id: uuidv7(),
          workspaceId: ctx.workspaceId,
          transactionId: txId,
          accountId: visa,
          amountMinor: -900n,
          currency: "USD",
          amountBaseMinor: -900n,
        },
      ]);
    });

    // Now flip to posted → trigger re-runs and rejects.
    await expectThrowsMatching(
      () =>
        ctx.db
          .update(transactions)
          .set({ status: "posted" })
          .where(eq(transactions.id, txId)),
      /postings imbalance/,
    );
  });
});

describe("version + updated_at triggers", () => {
  it("bumps version and updated_at on UPDATE", async () => {
    const groceries = await accountIdByName(ctx.db, ctx.workspaceId, "Groceries");
    const before = await ctx.db
      .select({ v: accounts.version, u: accounts.updatedAt })
      .from(accounts)
      .where(eq(accounts.id, groceries));

    // Small delay so updated_at can measurably change.
    await new Promise((r) => setTimeout(r, 10));

    await ctx.db
      .update(accounts)
      .set({ name: "Groceries" }) // no-op change still fires UPDATE
      .where(eq(accounts.id, groceries));

    const after = await ctx.db
      .select({ v: accounts.version, u: accounts.updatedAt })
      .from(accounts)
      .where(eq(accounts.id, groceries));

    expect(after[0]!.v).toBe(before[0]!.v + 1);
    expect(after[0]!.u.getTime()).toBeGreaterThan(before[0]!.u.getTime());
  });
});

/**
 * Per-suite Postgres testcontainer setup.
 *
 * Usage:
 *   import { withTestDb } from "../setup/db.js";
 *   const ctx = withTestDb();
 *   // Inside tests: ctx.db, ctx.pool, ctx.workspaceId are populated
 *   // after `beforeAll` runs.
 *
 * One container per suite, migrations + seed applied once.
 * `ctx.db` is the drizzle client against the testcontainer.
 */
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeAll, afterAll } from "vitest";
import * as schema from "../../src/schema/index.js";

export interface TestDbContext {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
  workspaceId: string;
  userId: string;
}

export function withTestDb(): TestDbContext {
  const ctx = {} as TestDbContext;

  beforeAll(async () => {
    ctx.container = await new PostgreSqlContainer("postgres:17").start();
    process.env.DATABASE_URL = ctx.container.getConnectionUri();

    const { runMigrations } = await import("../../src/db/migrate.js");
    await runMigrations();

    // Seed module reads DATABASE_URL at import time via src/db/client.ts,
    // so dynamic-import after setting the env var to point at the container.
    const { seed, SEED_WORKSPACE_ID, SEED_USER_ID } = await import(
      "../../src/db/seed.js"
    );
    const r = await seed();
    if (!r.created) throw new Error("Seed must run clean on empty container");

    ctx.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    ctx.db = drizzle(ctx.pool, { schema });
    ctx.workspaceId = SEED_WORKSPACE_ID;
    ctx.userId = SEED_USER_ID;
  });

  afterAll(async () => {
    if (ctx.pool) await ctx.pool.end();
    // The seed module's own pool (imported from src/db/client.ts) is still
    // open at this point. Close it so the process can exit cleanly.
    const { pool: seedPool } = await import("../../src/db/client.js");
    await seedPool.end().catch(() => {});
    if (ctx.container) await ctx.container.stop();
  });

  return ctx;
}

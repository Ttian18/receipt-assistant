import { pgTable, uuid, text, jsonb, index } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { transactions } from "./transactions.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

/**
 * Append-only audit log for transaction mutations.
 *
 * Emitted by the service layer (not DB triggers) so cross-request
 * correlation (actor_id, request_id) can be attached explicitly.
 *
 * event_type examples:
 *   created | updated | posting_added | posting_updated | posting_removed
 *   voided  | reconciled | document_linked | document_unlinked
 */
export const transactionEvents = pgTable(
  "transaction_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").notNull(),
    occurredAt: createdAt,
  },
  (t) => [index("txn_events_txn_idx").on(t.transactionId, t.occurredAt)],
);

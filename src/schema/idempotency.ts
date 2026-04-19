import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { workspaces } from "./workspaces.js";

/**
 * Stripe-style idempotency keys.
 *
 * Scope is per-workspace: two workspaces may submit the same key
 * independently.
 *
 * request_hash is sha256 of the canonicalized request body so that
 * replay of the same key with a *different* payload returns 409.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("idempotency_keys_uniq").on(t.workspaceId, t.key)],
);

import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  jsonb,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { txnStatusEnum } from "./enums.js";
import { createdAt, updatedAt, version } from "./common.js";
import { workspaces } from "./workspaces.js";
import { users } from "./users.js";

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    occurredOn: date("occurred_on").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    payee: text("payee"),
    narration: text("narration"),
    status: txnStatusEnum("status").notNull().default("posted"),
    voidedById: uuid("voided_by_id").references(
      (): AnyPgColumn => transactions.id,
      { onDelete: "set null" },
    ),
    // source_ingest_id is a forward-reference to the `ingests` table
    // introduced by the batch-ingest epic (#32). We keep it as a bare
    // uuid column for now — FK added in the ingests migration.
    sourceIngestId: uuid("source_ingest_id"),
    // trip_id is a forward-reference to the future trips table.
    tripId: uuid("trip_id"),
    metadata: jsonb("metadata").notNull().default({}),
    version,
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt,
  },
  (t) => [
    // Keyset pagination: (workspace, occurred_on DESC, id DESC)
    index("transactions_keyset_idx").on(
      t.workspaceId,
      t.occurredOn.desc(),
      t.id.desc(),
    ),
    index("transactions_status_idx").on(t.workspaceId, t.status),
    index("transactions_source_ingest_idx").on(t.sourceIngestId),
    index("transactions_trip_idx").on(t.tripId),
  ],
);

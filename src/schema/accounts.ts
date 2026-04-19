import {
  pgTable,
  uuid,
  text,
  char,
  bigint,
  timestamp,
  jsonb,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountTypeEnum } from "./enums.js";
import { createdAt, updatedAt, version } from "./common.js";
import { workspaces } from "./workspaces.js";

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => accounts.id, {
      onDelete: "restrict",
    }),
    code: text("code"),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    subtype: text("subtype"),
    currency: char("currency", { length: 3 }).notNull(),
    institution: text("institution"),
    last4: text("last4"),
    openingBalanceMinor: bigint("opening_balance_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    version,
    createdAt,
    updatedAt,
  },
  (t) => [
    index("accounts_workspace_idx").on(t.workspaceId),
    index("accounts_parent_idx").on(t.parentId),
    index("accounts_workspace_type_idx").on(t.workspaceId, t.type),
  ],
);

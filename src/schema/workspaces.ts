import { pgTable, uuid, text, char, primaryKey } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./common.js";
import { users } from "./users.js";
import { workspaceRoleEnum } from "./enums.js";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  baseCurrency: char("base_currency", { length: 3 }).notNull(),
  createdAt,
  updatedAt,
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

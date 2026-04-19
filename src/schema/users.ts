import { pgTable, uuid, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, updatedAt } from "./common.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    // citext requires the citext extension; we use lower(email) uniqueness
    // via a unique index instead to avoid extension coupling.
    email: text("email").notNull(),
    name: text("name"),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex("users_email_lower_uniq").on(sql`lower(${t.email})`)],
);

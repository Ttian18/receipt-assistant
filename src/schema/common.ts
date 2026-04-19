import { timestamp, bigint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .default(sql`NOW()`);

export const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .default(sql`NOW()`);

export const version = bigint("version", { mode: "number" })
  .notNull()
  .default(1);

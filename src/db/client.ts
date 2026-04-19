/**
 * Database client — drizzle ORM over node-postgres.
 *
 * Config via DATABASE_URL (Twelve-Factor §III).
 *
 * Export shape:
 *   - `db`      — drizzle client, type-aware with schema (use for queries)
 *   - `pool`    — raw pg.Pool (use sparingly, for migration runner / raw SQL)
 *   - `schema`  — re-exported table definitions
 */
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../schema/index.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/receipts";

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

export const db = drizzle(pool, { schema });

export { schema };

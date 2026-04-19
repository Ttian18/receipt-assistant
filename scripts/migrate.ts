/**
 * CLI wrapper: `npm run db:migrate` → runs pending Drizzle migrations.
 * Core logic lives in `src/db/migrate.ts` so the container can reuse it
 * without depending on tsx at runtime.
 */
import "dotenv/config";
import { runMigrations } from "../src/db/migrate.js";

runMigrations()
  .then(() => {
    console.log("✅ Migrations complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  });

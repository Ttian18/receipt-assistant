/**
 * CLI wrapper: `npm run db:seed` → inserts the default workspace + chart
 * of accounts. Idempotent. Core logic lives in `src/db/seed.ts`.
 */
import "dotenv/config";
import { seed } from "../src/db/seed.js";
import { pool } from "../src/db/client.js";

seed()
  .then((r) => {
    console.log(
      r.created
        ? `✅ Seeded workspace=${r.workspaceId} user=${r.userId}`
        : `ℹ️  Workspace ${r.workspaceId} already exists; skipped`,
    );
  })
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());

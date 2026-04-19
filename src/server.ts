/**
 * HTTP + MCP entrypoint.
 *
 * Post-refactor state (epic #28 in progress):
 *   - Old `/receipt*`, `/jobs/*`, `/summary`, `/ask` endpoints removed.
 *   - New `/v1/*` surface (transactions, accounts, documents) is being
 *     built out under #35 and #36 and will land here in follow-up PRs.
 *
 * This file currently exposes only:
 *   - `GET  /health`
 *   - `GET  /openapi.json`
 *   - `GET  /docs`
 *
 * Boot sequence:
 *   1. Run pending Drizzle migrations (from the committed `drizzle/`
 *      folder). Fail fast on any migration error.
 *   2. Start the MCP server (currently with no tools registered).
 *   3. Start the Express HTTP server.
 */
import "dotenv/config";
import { FastMCP } from "fastmcp";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "./openapi.js";
import { runMigrations } from "./db/migrate.js";
import { seed } from "./db/seed.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const MCP_PORT = parseInt(process.env.MCP_PORT ?? "3001", 10);

// ── MCP server (empty scaffold; tools ship with v1 resource PRs) ────────

const mcp = new FastMCP({
  name: "receipt-assistant",
  version: "2.0.0",
});

// ── HTTP server ─────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const openApiDoc = buildOpenApiDocument();
app.get("/openapi.json", (_req: Request, res: Response) => {
  res.json(openApiDoc);
});
app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiDoc, {
    customSiteTitle: "Receipt Assistant API",
    swaggerOptions: { persistAuthorization: true },
  }),
);

// Optional bearer-token gate (no-op when AUTH_TOKEN is unset).
const AUTH_TOKEN = process.env.AUTH_TOKEN;
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!AUTH_TOKEN) return next();
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== AUTH_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
app.use(authMiddleware);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "receipt-assistant", version: "2.0.0-alpha" });
});

// ── Startup ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🗄️  Running Drizzle migrations…");
  await runMigrations();
  console.log("✅ Migrations complete");

  // Idempotent seed — no-op if the default workspace already exists.
  // Opt out with SEED_ON_BOOT=false for production workspaces that
  // own their own chart-of-accounts bootstrap.
  if (process.env.SEED_ON_BOOT !== "false") {
    const r = await seed();
    console.log(
      r.created
        ? `🌱 Seeded workspace=${r.workspaceId}`
        : `🌱 Workspace ${r.workspaceId} already present`,
    );
  }

  mcp.start({
    transportType: "httpStream",
    httpStream: { port: MCP_PORT },
  });
  console.log(`🔌 MCP server listening on http://0.0.0.0:${MCP_PORT}/mcp`);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 HTTP API listening on http://0.0.0.0:${PORT}`);
    console.log(`
📋 Active endpoints:
   GET  /health          — health check
   GET  /openapi.json    — OpenAPI 3.1 spec (v2.0.0-alpha)
   GET  /docs            — interactive Swagger UI

🚧 v1 resources (transactions / accounts / documents) land under #35 and #36.
    `);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

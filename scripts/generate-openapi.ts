#!/usr/bin/env tsx
/**
 * Regenerate openapi/openapi.json from the in-code zod registry.
 * Run via `npm run openapi:generate`.
 *
 * The committed openapi.json is the source of truth for SDK codegen
 * and PR review — keep it in sync after every schema/route change.
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { buildOpenApiDocument } from "../src/openapi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "..", "openapi", "openapi.json");

mkdirSync(dirname(outPath), { recursive: true });

const doc = buildOpenApiDocument();
writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");

console.log(`✓ Wrote ${outPath}`);
console.log(`  ${Object.keys(doc.paths ?? {}).length} paths, ` +
            `${Object.keys((doc.components as any)?.schemas ?? {}).length} schemas`);

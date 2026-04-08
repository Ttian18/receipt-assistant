import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export interface ClaudeReceiptQuickResult {
  merchant: string;
  date: string;
  total: number;
  currency?: string;
}

export interface ClaudeReceiptResult {
  merchant: string;
  date: string;
  total: number;
  currency?: string;
  category?: string;
  payment_method?: string;
  tax?: number;
  tip?: number;
  notes?: string;
  raw_text?: string;
  items?: {
    name: string;
    quantity?: number;
    unit_price?: number;
    total_price?: number;
    category?: string;
  }[];
}

// Minimal schema for quick extraction (phase 1: merchant, date, total only)
const RECEIPT_QUICK_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: "string", description: "Store/restaurant name" },
    date: { type: "string", description: "Purchase date in YYYY-MM-DD format" },
    total: { type: "number", description: "Total amount paid" },
    currency: { type: "string", description: "Currency code, e.g. USD, CNY" },
  },
  required: ["merchant", "date", "total"],
};

// JSON Schema that constrains Claude's output for receipt extraction
const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: "string", description: "Store/restaurant name" },
    date: { type: "string", description: "Purchase date in YYYY-MM-DD format" },
    total: { type: "number", description: "Total amount paid" },
    currency: { type: "string", description: "Currency code, e.g. USD, CNY" },
    category: {
      type: "string",
      enum: ["food", "groceries", "transport", "shopping", "utilities", "entertainment", "health", "education", "travel", "other"],
      description: "Spending category",
    },
    payment_method: {
      type: "string",
      enum: ["credit_card", "debit_card", "cash", "mobile_pay", "other"],
      description: "Payment method used",
    },
    tax: { type: "number", description: "Tax amount if visible" },
    tip: { type: "number", description: "Tip amount if visible" },
    notes: { type: "string", description: "Any relevant notes" },
    raw_text: { type: "string", description: "Full text content of the receipt" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          total_price: { type: "number" },
          category: { type: "string" },
        },
        required: ["name"],
      },
      description: "Individual line items on the receipt",
    },
  },
  required: ["merchant", "date", "total"],
};

/**
 * Build a clean env for spawning claude CLI subprocesses.
 * - Removes CLAUDECODE to avoid "nested session" errors
 * - Removes ANTHROPIC_API_KEY to force subscription auth
 */
function buildClaudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.ANTHROPIC_API_KEY;
  return env;
}

/**
 * Run `claude` CLI and return stdout as string.
 * stdin is closed immediately to avoid "no stdin data" warnings.
 */
function runClaude(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      env: buildClaudeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Claude CLI exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Phase 1: Quick extraction — merchant, date, total only.
 * Uses --effort low and --max-turns 1 for fast turnaround (~3-5s).
 */
export async function extractReceiptQuick(imagePath: string): Promise<ClaudeReceiptQuickResult> {
  const absPath = path.resolve(imagePath);
  await fs.access(absPath);

  const prompt = `Look at the receipt image at "${absPath}". Extract ONLY: merchant name, date (YYYY-MM-DD), total amount, and currency. Nothing else.`;

  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--json-schema", JSON.stringify(RECEIPT_QUICK_SCHEMA),
    "--dangerously-skip-permissions",
    "--max-turns", "3",
    "--effort", "low",
    "--model", process.env.CLAUDE_MODEL || "sonnet",
    // Session traces saved to $HOME/.claude/ for later analysis
  ];

  try {
    const stdout = await runClaude(args, 30_000);
    const parsed = JSON.parse(stdout);

    const resultObj = Array.isArray(parsed)
      ? parsed.find((m: any) => m.type === "result")
      : (parsed.type === "result" ? parsed : null);

    if (!resultObj) throw new Error("No result found in Claude CLI output");

    if (resultObj.is_error) {
      throw new Error(resultObj.errors?.join("; ") || resultObj.result || "Claude returned an error");
    }

    const data = resultObj.structured_output ?? resultObj.result;
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch (err: any) {
    throw new Error(`Claude CLI quick extraction failed: ${err.message || "Unknown error"}`);
  }
}

/**
 * Phase 2: Full extraction — all fields including line items, tax, raw_text.
 * Uses `claude -p` (headless mode) with JSON schema output.
 * Runs under your CC subscription — no API key needed.
 */
export async function extractReceipt(imagePath: string): Promise<ClaudeReceiptResult> {
  const absPath = path.resolve(imagePath);
  // Verify image exists
  await fs.access(absPath);

  const prompt = `You are a receipt parser. Look at the receipt image at "${absPath}" and extract all information.

Rules:
- Date must be YYYY-MM-DD format. If year is not visible, assume the current year.
- Total must be the final amount paid (after tax/tip if applicable).
- Currency: detect from symbols ($ = USD, ¥ = CNY/JPY, € = EUR, etc.)
- Category: choose the most appropriate from the allowed values.
- Extract ALL line items you can see.
- For raw_text: transcribe the full receipt text.
- If something is not visible, omit it (don't guess).

Read the image file and extract the receipt data.`;

  const args = [
    "-p", prompt,
    "--output-format", "json",
    "--json-schema", JSON.stringify(RECEIPT_SCHEMA),
    "--dangerously-skip-permissions",
    "--max-turns", "10",
    "--model", process.env.CLAUDE_MODEL || "sonnet",
    // Session traces saved to $HOME/.claude/ for later analysis
  ];

  try {
    const stdout = await runClaude(args, 120_000);
    // claude --output-format json may produce either:
    //   - A single JSON object (e.g. in Docker with --dangerously-skip-permissions)
    //   - A JSON array of message objects (e.g. locally)
    const parsed = JSON.parse(stdout);
    const resultObj = Array.isArray(parsed)
      ? parsed.find((m: any) => m.type === "result")
      : (parsed.type === "result" ? parsed : null);

    if (!resultObj) {
      throw new Error("No result found in Claude CLI output");
    }

    if (resultObj.is_error) {
      throw new Error(resultObj.errors?.join("; ") || resultObj.result || "Claude returned an error");
    }

    const data = resultObj.structured_output ?? resultObj.result;
    if (typeof data === "string") {
      return JSON.parse(data);
    }
    return data;
  } catch (err: any) {
    const message = err.message || "Unknown error";
    throw new Error(`Claude CLI failed: ${message}`);
  }
}

/**
 * Ask Claude a free-form question about receipts (e.g. spending analysis).
 * Returns plain text response.
 */
export async function askClaude(prompt: string): Promise<string> {
  const args = [
    "-p", prompt,
    "--output-format", "text",
    "--tools", "",
    "--max-turns", "3",
    "--model", process.env.CLAUDE_MODEL || "sonnet",
    // Session traces saved to $HOME/.claude/ for later analysis
  ];

  const stdout = await runClaude(args, 60_000);

  // Extract result from JSON output (single object or array)
  try {
    const parsed = JSON.parse(stdout);
    const resultObj = Array.isArray(parsed)
      ? parsed.find((m: any) => m.type === "result")
      : (parsed.type === "result" ? parsed : null);
    if (resultObj) {
      return resultObj.result ?? "";
    }
  } catch {
    // Fallback: return raw output
  }

  return stdout.trim();
}

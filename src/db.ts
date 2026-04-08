import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "/data/receipts.db";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      merchant TEXT NOT NULL,
      date TEXT NOT NULL,           -- ISO 8601 date: YYYY-MM-DD
      total REAL NOT NULL,          -- total amount
      currency TEXT DEFAULT 'USD',
      category TEXT,                -- e.g. 'food', 'transport', 'shopping', 'utilities'
      payment_method TEXT,          -- e.g. 'credit_card', 'cash', 'debit'
      tax REAL,
      tip REAL,
      notes TEXT,
      raw_text TEXT,                -- full OCR text for reference
      image_path TEXT,              -- path to original image
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity REAL DEFAULT 1,
      unit_price REAL,
      total_price REAL,
      category TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);
    CREATE INDEX IF NOT EXISTS idx_receipts_merchant ON receipts(merchant);
    CREATE INDEX IF NOT EXISTS idx_receipts_category ON receipts(category);
  `);
}

export interface ReceiptData {
  id: string;
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
  image_path?: string;
  items?: {
    name: string;
    quantity?: number;
    unit_price?: number;
    total_price?: number;
    category?: string;
  }[];
}

export function insertReceipt(data: ReceiptData): ReceiptData {
  const db = getDb();
  const insertMain = db.prepare(`
    INSERT INTO receipts (id, merchant, date, total, currency, category,
      payment_method, tax, tip, notes, raw_text, image_path)
    VALUES (@id, @merchant, @date, @total, @currency, @category,
      @payment_method, @tax, @tip, @notes, @raw_text, @image_path)
  `);
  const insertItem = db.prepare(`
    INSERT INTO receipt_items (receipt_id, name, quantity, unit_price, total_price, category)
    VALUES (@receipt_id, @name, @quantity, @unit_price, @total_price, @category)
  `);

  const tx = db.transaction(() => {
    insertMain.run({
      id: data.id,
      merchant: data.merchant,
      date: data.date,
      total: data.total,
      currency: data.currency ?? "USD",
      category: data.category ?? null,
      payment_method: data.payment_method ?? null,
      tax: data.tax ?? null,
      tip: data.tip ?? null,
      notes: data.notes ?? null,
      raw_text: data.raw_text ?? null,
      image_path: data.image_path ?? null,
    });

    if (data.items) {
      for (const item of data.items) {
        insertItem.run({
          receipt_id: data.id,
          name: item.name,
          quantity: item.quantity ?? 1,
          unit_price: item.unit_price ?? null,
          total_price: item.total_price ?? null,
          category: item.category ?? null,
        });
      }
    }
  });

  tx();
  return data;
}

// ── Query helpers ─────────────────────────────────────────────────────

export function getReceipt(id: string) {
  const db = getDb();
  const receipt = db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
  if (!receipt) return null;
  const items = db.prepare("SELECT * FROM receipt_items WHERE receipt_id = ?").all(id);
  return { ...receipt, items };
}

export function listReceipts(opts?: {
  from?: string;
  to?: string;
  category?: string;
  limit?: number;
}): unknown[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (opts?.from) {
    conditions.push("date >= @from");
    params.from = opts.from;
  }
  if (opts?.to) {
    conditions.push("date <= @to");
    params.to = opts.to;
  }
  if (opts?.category) {
    conditions.push("category = @category");
    params.category = opts.category;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;

  return db.prepare(`SELECT * FROM receipts ${where} ORDER BY date DESC LIMIT ${limit}`).all(params);
}

export function getSpendingSummary(from?: string, to?: string): unknown[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (from) {
    conditions.push("date >= @from");
    params.from = from;
  }
  if (to) {
    conditions.push("date <= @to");
    params.to = to;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return db.prepare(`
    SELECT
      category,
      COUNT(*) as count,
      ROUND(SUM(total), 2) as total_spent,
      ROUND(AVG(total), 2) as avg_per_receipt
    FROM receipts
    ${where}
    GROUP BY category
    ORDER BY total_spent DESC
  `).all(params);
}

// Run init if called directly
if (process.argv[1]?.endsWith("db.js") || process.argv[1]?.endsWith("db.ts")) {
  getDb();
  console.log(`✅ Database initialized at ${DB_PATH}`);
}

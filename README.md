# Receipt Assistant

An open-source, AI-native receipt parsing backend that extracts structured data from receipt images using Claude Code CLI, stores results in PostgreSQL, and monitors every AI call through Langfuse.

## Architecture

```
                     ┌──────────────┐
  Receipt Image ───► │  Express API │ ───► PostgreSQL
  (POST /receipt)    │   :3000      │      (receipts db)
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         Phase 1       Phase 2        Langfuse
         Quick OCR     Two-Step       Auto-Ingest
         (3-5s)        Pipeline       (traces + generations)
         merchant      1. Text OCR    ┌─────────────┐
         date          + reasoning    │ Langfuse     │
         total         2. JSON        │ Dashboard    │
                       structuring    │ :3333        │
                       + quality      └─────────────┘
                       flags
```

### Two-Step Pipeline

We discovered that `--json-schema` constrains Claude's output format and **degrades OCR accuracy** (4/10 dates wrong vs 0/10 with plain text). Our solution:

1. **Step 1**: Plain text OCR with chain-of-thought reasoning (no schema constraint)
2. **Step 2**: Structure the OCR text into JSON (with schema constraint, but no image reading)

This separation lets the model reason about ambiguous characters ("is this a 3 or 9?") before committing to a structured output.

### Quality & Business Flags

Every extraction includes metadata stored as PostgreSQL JSONB:

```json
{
  "quality": {
    "confidence_score": 0.72,
    "missing_fields": ["notes"],
    "warnings": ["truncated_merchant", "handwritten_tip", "partial_ocr"]
  },
  "business": {
    "is_reimbursable": false,
    "is_tax_deductible": true,
    "is_recurring": false,
    "is_split_bill": false
  }
}
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Claude Code CLI with active subscription
- macOS (for Keychain-based OAuth token extraction)

### 1. Start Langfuse monitoring stack

```bash
cd langfuse/
docker compose up -d
# Dashboard: http://localhost:3333 (admin@local.dev / Admin123!)
```

### 2. Build and run the backend

```bash
# Extract OAuth token from macOS Keychain
export CLAUDE_CODE_OAUTH_TOKEN=$(security find-generic-password \
  -s "Claude Code-credentials" -w | \
  python3 -c "import json,sys; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])")

# Build
docker build -t receipt-assistant .

# Run (joins Langfuse network, shares its PostgreSQL)
docker run -d \
  --name receipt-assistant \
  --network langfuse_default \
  -p 3000:3000 -p 3001:3001 \
  -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  -e DATABASE_URL="postgresql://postgres:postgres@postgres:5432/receipts" \
  -e LANGFUSE_HOST="http://langfuse-web:3000" \
  -e LANGFUSE_PUBLIC_KEY="pk-receipt-local" \
  -e LANGFUSE_SECRET_KEY="sk-receipt-local" \
  -v receipt-data:/data \
  receipt-assistant
```

### 3. Test with a receipt

```bash
# Upload
curl -X POST http://localhost:3000/receipt -F "image=@receipt.jpg"

# Poll for result
curl http://localhost:3000/jobs/<jobId>

# Or use the verify script for end-to-end testing
./scripts/verify-receipt.sh ~/path/to/receipt.jpg
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/receipt` | Upload receipt image, returns jobId for async processing |
| `GET` | `/jobs/:id` | Poll job status (queued → quick_done → processing_full → done) |
| `GET` | `/jobs/:id/stream` | SSE stream for real-time progress |
| `GET` | `/receipts` | List receipts (`?from=&to=&category=&limit=`) |
| `GET` | `/receipt/:id` | Get single receipt with line items |
| `DELETE` | `/receipt/:id` | Delete a receipt |
| `GET` | `/summary` | Spending summary by category (`?from=&to=`) |
| `POST` | `/ask` | Ask a natural language question about spending |
| `GET` | `/health` | Health check |

### MCP Tools (port 3001)

| Tool | Description |
|------|-------------|
| `process_receipt` | Parse a receipt image and save to database |
| `list_receipts` | List receipts with date/category filters |
| `spending_summary` | Spending aggregated by category |
| `get_receipt` | Get receipt details with line items |
| `ask_about_spending` | Natural language query about spending habits |

## Langfuse Monitoring

Every `claude -p` call is automatically traced in Langfuse with:
- Model name, token usage, latency
- Input prompt and output
- Phase tags (`phase-1/quick`, `phase-2/full`)
- Tool calls

### Query traces via API

```bash
# List recent traces
curl -s http://localhost:3333/api/public/traces \
  -u "pk-receipt-local:sk-receipt-local"

# Get a specific trace
curl -s http://localhost:3333/api/public/traces/<trace-id> \
  -u "pk-receipt-local:sk-receipt-local"
```

## Scripts

| Script | Usage |
|--------|-------|
| `scripts/verify-receipt.sh <image>` | End-to-end: upload → parse → show App result + Langfuse trace |
| `scripts/batch-test.sh <dir> [n]` | Batch test N receipts from a directory |

## Tech Stack

- **Runtime**: Node.js 22 + TypeScript (ES2022)
- **Framework**: Express 5 + FastMCP
- **Database**: PostgreSQL (shared with Langfuse)
- **AI**: Claude Code CLI (`claude -p`) with subscription auth
- **Monitoring**: Langfuse (self-hosted)
- **Image Processing**: heic-convert (HEIC → JPEG)

## Frontend

See [receipt-assistant-frontend](https://github.com/TINKPA/receipt-assistant-frontend) for the React dashboard.

## License

MIT

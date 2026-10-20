# Defect RCA RAG

An Express service that takes a defect number from a vendor instance and finds the test cases that cover it. It checks existing mappings first, then runs a vector similarity search over test cases stored in ChromaDB. If nothing matches, it asks a local LLM (Ollama) to write a new test case. A second endpoint maps the defect to the chosen test case, creating the test case in vendor if it was AI-generated, and opens a draft RCA record linked to the defect.

Everything except the vendor instance runs locally: the LLM and the embeddings run on Ollama, and the vectors are stored in a local ChromaDB server.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Service](#running-the-service)
- [Seeding the Vector Store](#seeding-the-vector-store)
- [API Reference](#api-reference)
- [Scripts & Utilities](#scripts--utilities)
- [Project Structure](#project-structure)
- [Logging](#logging)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## How It Works

### Flow 1 — Analyze a defect

`GET /api/v1/defects/:defectNumber/analyze`

1. **Fetch the defect** from vendor (`x_snc_defect_defect`), once as raw values and once as display values.
2. **Check existing mappings** in `x_snc_test_now_m2m_test_cases_tasks`. If the defect already has test cases mapped to it, they are returned with `matchType: "MAPPED"`.
3. **Similarity search.** Builds a search text from the defect's short description, description, prerequisites and steps to reproduce. Embeds it with `nomic-embed-text`, normalizes the vector to unit length, and queries ChromaDB. Results at or above `SIMILARITY_THRESHOLD` are kept, and the top 3 are returned.
4. **LLM enrichment.** For each match, the LLM runs a similarity analysis that adds a score, reasoning, a confidence level and a recommendation. The results are returned with `matchType: "EXISTING"`.
5. **Generation fallback.** If nothing passes the threshold, the LLM writes a new test case as JSON. It gets a temporary ID (`TC-<timestamp>-<rand>`), is embedded and stored in ChromaDB, and is returned with `matchType: "GENERATED"`.

### Flow 2 — Map a test case and create an RCA

`GET /api/v1/defects/:defectNumber/testcases/:testCaseId/mappings`

1. Fetch the defect from vendor.
2. Look up `testCaseId` in vendor. If it isn't there, treat it as an AI-generated test case:
   - Load it from ChromaDB and convert its steps to an HTML table.
   - Create it in vendor (`x_snc_test_now_test_case`).
   - Re-key the vector entry from the temporary `TC-*` ID to the new vendor `sys_id`. The embedding and document are kept.
3. Create the defect ↔ test case mapping record.
4. Create a **draft RCA** record (`u_rca`) filled in from the defect: release, product, category and assignment group.
5. Update the defect's `u_rca` reference to point at the new RCA.

> The RCA is a templated draft record. The LLM does not write its content.

---

## Architecture

> For detailed diagrams, API contracts, configuration and known risks, see [ARCHITECTURE.md](ARCHITECTURE.md).

```
                 ┌──────────────────────────────┐
  HTTP client ──►│  Express API  (src/server.js)│
                 │  helmet · cors · rate limit  │
                 └──────────────┬───────────────┘
                                │
                     DefectController
                                │
                 ┌──────────────┴───────────────┐
                 │          RAGService          │
                 └───┬──────────┬───────────┬───┘
                     │          │           │
          VectorDbService   LLMService   ExternalApiService
                     │          │           │
                     ▼          ▼           ▼
                 ChromaDB    Ollama     vendor REST
                 :8000       :11434     (OAuth2, Table API)
```

| Component | File | Responsibility |
|---|---|---|
| `DefectAutomationServer` | `src/server.js` | Express setup, middleware, routes, graceful shutdown |
| `DefectController` | `src/controllers/defectController.js` | Orchestrates the two flows and the health check |
| `RAGService` | `src/services/ragService.js` | Builds search text, similarity search, LLM enrichment, test case generation and storage, HTML step conversion |
| `VectorDbService` | `src/services/vectorDbService.js` | ChromaDB collection lifecycle, add/query/re-key/delete, stats |
| `LLMService` | `src/services/llmService.js` | Ollama embeddings, test case generation, similarity analysis |
| `ExternalApiService` | `src/services/externalApiService.js` | OAuth token caching and refresh, vendor Table API calls |
| `normalizeEmbedding` | `src/utils/embedding.js` | L2-normalizes vectors before they are stored or queried |

### vendor tables used

| Purpose | Table |
|---|---|
| Defects | `x_snc_defect_defect` |
| Test cases | `x_snc_test_now_test_case` |
| Defect ↔ test case mappings | `x_snc_test_now_m2m_test_cases_tasks` |
| RCA records | `u_rca` |

---

## Tech Stack

- **Runtime:** Node.js ≥ 16
- **Web:** Express 4, helmet, cors, compression, express-rate-limit
- **Vector DB:** ChromaDB (Python server) + `chromadb` JS client
- **LLM / embeddings:** Ollama — `llama2:7b` (generation) and `nomic-embed-text` (embeddings) by default
- **HTTP client:** axios
- **Logging:** winston + winston-daily-rotate-file
- **Dev:** nodemon, jest, supertest

---

## Prerequisites

- **Node.js 16+** and npm
- **Python 3** (for the ChromaDB server)
- **Ollama** with the generation and embedding models pulled
- A **vendor instance** with an OAuth application registry entry (client ID and secret) that can read and write the tables above

---

## Installation

### Option A — Automated (macOS)

`setup.sh` checks for Node and Python, installs Homebrew, Ollama and Python 3.10 if they're missing, pulls the models, creates a `venv/` with ChromaDB, runs `npm install`, and writes a starter `.env`.

```bash
chmod +x setup.sh
./setup.sh            # full setup
```

> The `.env` that `setup.sh` writes uses different variable names from the ones the code reads. See [Configuration](#configuration) and fix the file before you start the service.

### Option B — Manual

```bash
# 1. Node dependencies
npm install

# 2. Ollama + models
brew install ollama            # or see https://ollama.com/download
ollama serve &
ollama pull llama2:7b
ollama pull nomic-embed-text

# 3. ChromaDB
python3 -m venv venv
source venv/bin/activate
pip install chromadb
chroma run --host localhost --port 8000
```

---

## Configuration

Create a `.env` file in the project root. It is git-ignored. The variables below are the ones the code actually reads:

```env
# ── Server ──────────────────────────────────────────
PORT=3333                       # default 3000
NODE_ENV=development            # 'production' disables console logs & stack traces
ALLOWED_ORIGINS=                # comma-separated CORS origins; default '*'
RATE_LIMIT_WINDOW_MS=900000     # default 15 min
RATE_LIMIT_MAX_REQUESTS=100     # per window, applied to /api/*

# ── vendor (OAuth2 client credentials) ─────────
EXTERNAL_API_BASE_URL=https://<your-instance>.service-now.com
EXTERNAL_CLIENT_ID=<client_id>
EXTERNAL_CLIENT_SECRET=<client_secret>
EXTERNAL_GRANT_TYPE=client_credentials
EXTERNAL_API_TIMEOUT=30000      # ms

# ── Ollama ──────────────────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2:7b
EMBEDDING_MODEL=nomic-embed-text
OLLAMA_TIMEOUT=60000            # ms

# ── ChromaDB ────────────────────────────────────────
CHROMA_HOST=localhost
CHROMA_PORT=8000
CHROMA_COLLECTION_NAME=defect_test_case_rca

# ── Retrieval ───────────────────────────────────────
SIMILARITY_THRESHOLD=0.65       # 0–1; default 0.7
MAX_SIMILAR_RESULTS=10          # cap on vector query size
BATCH_SIZE=                     # batch size for bulk vector inserts

# ── Logging ─────────────────────────────────────────
LOG_DIR=./logs
LOG_LEVEL=info
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d
```

> **Heads-up:** `setup.sh` writes `EXTERNAL_API_USERNAME`, `EXTERNAL_API_PASSWORD`, `EXTERNAL_API_CLIENT_ID` and `EXTERNAL_API_CLIENT_SECRET`. The code doesn't read any of these. It reads `EXTERNAL_CLIENT_ID`, `EXTERNAL_CLIENT_SECRET` and `EXTERNAL_GRANT_TYPE`.

---

## Running the Service

Start the dependencies, then the API:

```bash
./setup.sh start        # starts Ollama + ChromaDB in the background (PIDs in .ollama.pid / .chroma.pid)
npm start               # or: npm run dev  (nodemon auto-reload)
```

Other helper commands:

```bash
./setup.sh status       # checks Ollama, ChromaDB, and the API (API check assumes port 3000)
./setup.sh stop         # stops services started by ./setup.sh start
./setup.sh help
```

On startup the server connects to the ChromaDB collection, creating it if it doesn't exist, and then listens on `PORT`.

---

## Seeding the Vector Store

Similarity search only works once test cases are in ChromaDB. The seeder pulls test cases from vendor (created on or after 2023-01-01, newest first), embeds each one, and stores it.

```bash
# Seed 1,000 test cases, fetching 500 per API call
node scripts/seedData.js test-case --batch-size=500 --total-records=1000

# Seed everything available
node scripts/seedData.js test-case --batch-size=1000

# npm shortcut
npm run seed -- test-case --batch-size=500
```

| Flag | Default | Meaning |
|---|---|---|
| `--batch-size=N` | 1000 | Records fetched per vendor request |
| `--total-records=N` | all | Number of **additional** records to seed in this run |

The seeder can be resumed. Progress (offset, counts, last run) is saved to `data/seed-tracking.json`, and each run continues from the last offset. To start over, reset that file and delete the collection (see below).

---

## API Reference

Base URL: `http://localhost:<PORT>`

The defect endpoints include a `requestId` in every response. If you send an `x-request-id` header, its value is used.

### `GET /health`

Basic liveness check.

```json
{ "status": "healthy", "timestamp": "…", "version": "1.0.0", "environment": "development" }
```

### `GET /api/v1/health`

Checks the dependencies: gets an OAuth token, runs a one-row vendor query, and reads the ChromaDB collection stats.

```json
{
  "status": "healthy",
  "timestamp": "…",
  "services": {
    "externalApi": { "status": "up", "oauth": "authenticated", "api": "accessible" },
    "vectorDb": "up",
    "vectorDbStats": { "…": "…" }
  }
}
```

### `GET /api/v1/defects/:defectNumber/analyze`

```bash
curl http://localhost:3333/api/v1/defects/DEF0001234/analyze
```

```json
{
  "success": true,
  "defect": { "number": "DEF0001234", "short_description": "…", "…": "display values" },
  "matchType": "EXISTING",
  "testCases": [
    {
      "sys_id": "…",
      "number": "TNTC0012345",
      "short_description": "…",
      "similarityAnalysis": {
        "similarity_score": 0.87,
        "reasoning": "…",
        "confidence": "high",
        "recommendation": "Highly recommended - Strong similarity detected"
      }
    }
  ],
  "processingTime": 2541,
  "requestId": "req-1753891234567-abcde"
}
```

| `matchType` | Meaning | Shape of `testCases[]` |
|---|---|---|
| `MAPPED` | Defect already had test case mappings in vendor | vendor test case records plus `mappingSysId` |
| `EXISTING` | Vector search found matches above the threshold (up to 3) | Test case records plus `similarityAnalysis` |
| `GENERATED` | No matches, so the LLM wrote a new test case | `[{ testCase: {...}, similarity: 1.0, confidence: "high", isGenerated: true }]` |

Confidence and recommendation thresholds:

| Vector similarity | Recommendation |
|---|---|
| > 0.85 | Highly recommended |
| > 0.70 | Recommended |
| otherwise | Consider with caution |

Errors: `404` if the defect can't be fetched, `500` for anything else.

### `GET /api/v1/defects/:defectNumber/testcases/:testCaseId/mappings`

`testCaseId` is either a vendor test case `sys_id` or a temporary `TC-*` ID returned by a `GENERATED` analysis.

```bash
curl http://localhost:3333/api/v1/defects/DEF0001234/testcases/TC-1753891234567-ab12c/mappings
```

```json
{
  "success": true,
  "defect":   { "…": "defect display values" },
  "testCase": { "sys_id": "…", "number": "TNTC0012345", "…": "…" },
  "mapping":  { "sys_id": "…", "task": "…", "test_case": "…" },
  "rca":      { "sys_id": "…", "u_number": "…", "…": "created RCA record" },
  "processingTime": 3254,
  "requestId": "req-…"
}
```

This endpoint **writes to vendor**: it creates a test case (only for `TC-*` IDs), a mapping record and an RCA record, and it updates the defect. It's a `GET` route, so be careful with crawlers, link previews and retries.

---

## Scripts & Utilities

| Command | Purpose |
|---|---|
| `node scripts/seedData.js test-case [...]` | Seed test cases from vendor into ChromaDB |
| `node scripts/manageCollections.js list` | List ChromaDB collections |
| `node scripts/manageCollections.js stats` | Show stats for the configured collection |
| `node scripts/manageCollections.js delete <name>` | Delete a collection |
| `node scripts/manageCollections.js delete-default` | Delete the configured collection |
| `node scripts/check-chromadb.js` | Print the document count and 10 sample records from `defect_test_case_rca` (reads `CHROMA_DB_URL`, default `http://localhost:8000`) |
| `node scripts/test-ollama.js` | Smoke-test Ollama connectivity, models, embeddings and generation |
| `python3 test-chromadb.py` | Smoke-test the ChromaDB server (heartbeat, collections, basic ops) on `localhost:8000` |

---

## Project Structure

```
defect-rca-rag/
├── src/
│   ├── server.js                    # Express app, middleware, routes, shutdown
│   ├── config/logger.js             # winston + daily rotating files
│   ├── controllers/defectController.js
│   ├── middleware/
│   │   ├── errorHandler.js          # 404 + global error handler
│   │   └── requestLogger.js         # HTTP request logging
│   ├── models/schemas.js            # Reference field schemas (not enforced at runtime)
│   ├── services/
│   │   ├── ragService.js
│   │   ├── vectorDbService.js
│   │   ├── llmService.js
│   │   └── externalApiService.js
│   └── utils/embedding.js           # normalizeEmbedding()
├── scripts/
│   ├── seedData.js
│   ├── manageCollections.js
│   ├── check-chromadb.js
│   └── test-ollama.js
├── data/
│   ├── seed-tracking.json           # Seeder resume state (read/written by seedData.js)
│   ├── defect-data.json             # Sample vendor defect payload (reference only)
│   ├── test-case.json               # Sample test case payload (reference only)
│   ├── rca-data.json                # Sample RCA payload (reference only)
│   └── defect-test-case-mapping.json# Sample mapping payload (reference only)
├── setup.sh                         # macOS setup + start/stop/status helper
├── test-chromadb.py
├── package.json
└── LICENSE
```

Git-ignored at runtime: `node_modules/`, `venv/`, `chroma/` (local vector data), `logs/`, `.env`.

---

## Logging

Logs are written to `LOG_DIR` (default `./logs`) and rotated daily:

| File | Level | Retention |
|---|---|---|
| `error-YYYY-MM-DD.log` | error | `LOG_MAX_FILES` (14d) |
| `combined-YYYY-MM-DD.log` | `LOG_LEVEL` | `LOG_MAX_FILES` (14d) |
| `api-YYYY-MM-DD.log` | http | 7d |

Rotated files are gzipped. When `NODE_ENV` isn't `production`, logs are also printed to the console. Each service logs under its own name (`RAGService`, `VectorDbService`, …), and the controller prefixes its messages with the `requestId`.

---

## Security

- `helmet` with a restrictive Content Security Policy
- CORS limited to `ALLOWED_ORIGINS`. **If this is unset, any origin is allowed.**
- Rate limiting on `/api/*`
- JSON body size limit of 10 MB
- OAuth tokens cached in memory, refreshed 60 s before expiry, and retried once on a `401`
- Stack traces are left out of error responses when `NODE_ENV=production`
- No authentication on the service's own endpoints. Run it behind a trusted network or a gateway.

---

## Troubleshooting

| Symptom | Things to check |
|---|---|
| `Failed to initialize VectorDB service` on startup | ChromaDB is running on `CHROMA_HOST:CHROMA_PORT`, and both variables are set (there are no defaults) |
| `OAuth authentication failed` | `EXTERNAL_CLIENT_ID`, `EXTERNAL_CLIENT_SECRET`, `EXTERNAL_GRANT_TYPE` and the base URL are correct, and the OAuth app exists in vendor |
| `Embedding generation failed` | `ollama serve` is running, and `ollama list` shows `EMBEDDING_MODEL` |
| Analyze always returns `GENERATED` | Collection is empty (run the seeder or `manageCollections.js stats`), or `SIMILARITY_THRESHOLD` is too high |
| `Port … is already in use` | Change `PORT` or stop the other process |
| `Failed to parse generated test case` | The model returned text that isn't JSON. Retry, or switch to a model that follows instructions more reliably via `OLLAMA_MODEL` |
| `./setup.sh status` says the API is down | It checks port 3000. If you set `PORT=3333`, query `/health` on that port instead |

---

## Known Limitations

- **Distance metric:** the collection is created with `embeddingFunction: 'cosine'`, which doesn't set ChromaDB's distance space (that's `metadata: { "hnsw:space": "cosine" }`). The collection therefore probably uses the default L2 metric. For unit vectors, `1 - L2²` equals `2·cos - 1`, not `cos`, so the effective threshold is stricter than the configured one.
- **Display-value merge:** in `ExternalApiService.getTestCaseListDetails`, the lookup `testCases.find(tc => tc.sys_id === tc.sys_id)` shadows the outer variable. Every result is merged with the first vendor record returned.
- **Route documentation drift:** the startup log and the `GET /` response advertise `POST /api/v1/defects/{defectNumber}/mappings`. The real route is `GET /api/v1/defects/:defectNumber/testcases/:testCaseId/mappings`.
- **Collection name in `check-chromadb.js`** is hard-coded to `defect_test_case_rca`, and the script reads `CHROMA_DB_URL` instead of `CHROMA_HOST`/`CHROMA_PORT`.
- **No automated tests yet.** `npm test` runs Jest, but the repo has no test files.
- **Required defect fields:** generation and RCA creation read `u_product_service`, `u_product_category`, `assignment_group` and `u_target_version` from the defect. Defects missing any of these fields will fail.

---

## License

[MIT](LICENSE) © 2025 Harish Dewangan

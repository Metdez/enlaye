# Enlaye — Construction Risk Intelligence Dashboard

> A full-stack risk analytics platform for construction portfolio managers. Upload a project history CSV, explore anomalies and KPI trends, compare dispute-prediction models side-by-side, chat with uploaded documents via RAG, and screen new deals against your own portfolio history using a k-nearest-neighbor algorithm — all from a single dashboard.

**Demo:** [enlaye-five.vercel.app](https://enlaye-five.vercel.app)

---

## Table of Contents

1. [Overview](#overview)
2. [The 30-Second Pitch](#the-30-second-pitch)
3. [Feature Walkthrough](#feature-walkthrough)
4. [System Architecture](#system-architecture)
5. [Tech Stack](#tech-stack)
6. [Repository Structure](#repository-structure)
7. [Database Schema](#database-schema)
8. [API Reference](#api-reference)
9. [Local Development](#local-development)
10. [Environment Variables](#environment-variables)
11. [Deployment](#deployment)
12. [Key Design Decisions](#key-design-decisions)
13. [Security Model](#security-model)
14. [Known Limitations](#known-limitations)
15. [Further Reading](#further-reading)

---

## Overview

Enlaye turns a firm's raw project history into actionable risk intelligence. The core insight: most construction firms already have the data to make better pre-construction decisions — it's locked in spreadsheets. Enlaye ingests that CSV, cleans it, and exposes the portfolio through five lenses:

| Lens | Question answered |
|---|---|
| **Dashboard** | How has this portfolio performed on delay, cost, and safety? |
| **Anomalies** | Which projects are statistical outliers, and why? |
| **Models** | What does an honest dispute-prediction model actually look like? |
| **Ask** | What do the project documents say about a specific topic? |
| **Screen** | Given a hypothetical deal, what have similar past projects looked like? |

---

## The 30-Second Pitch

> Most construction risk tools hide their math. This one makes the math the product.

The **Train Models** button fits two logistic regression classifiers on the same dataset:

- **Naive model** — trained with all available features, including outcome fields (`delay_days`, `cost_overrun_pct`, `safety_incidents`). Achieves ~100% accuracy. Completely useless — it uses data that only exists *after* a project finishes.
- **Pre-construction model** — trained only on bid-time features (`project_type`, `contract_value_usd`, `region`, `subcontractor_count`). Lower accuracy. Actually deployable.

The UI renders both side-by-side, highlights the leaky features in red, and explains *why* the gap exists. That explanation is the product.

---

## Feature Walkthrough

### 1. CSV Ingest & Data Cleaning

Drop a project history CSV onto the upload zone. The Python ML service (`POST /ingest`) handles:

- **Parsing** — PapaParse (frontend) validates headers before upload; pandas (backend) handles type coercion
- **Imputation** — missing numeric values filled with column **median** (not mean — construction data has high-value outliers that would skew mean imputation; rationale documented inline)
- **Anomaly flagging** — rows are flagged if they exceed configurable thresholds: cost overrun >25%, delay >150 days, safety incidents ≥5, payment disputes ≥5
- **Status** — in-progress rows skip outcome imputation (those values don't exist yet; imputing them would bias the model)

Cleaned records are written to the `projects` table. A cleaning report (rows inserted, skipped, columns imputed) is returned to the UI.

### 2. Summary Dashboard

Real-time portfolio overview built from server components reading directly from Postgres:

- **KPI tiles** — total projects, average delay (days), average cost overrun (%), dispute rate
- **Delay & overrun charts** — distribution by project type (bar), rendered with Recharts
- **Region donut** — project volume breakdown by region
- **Anomaly list** — flagged rows with rule, actual value, and threshold displayed inline

### 3. Two-Model Comparison (The Showcase)

The centerpiece of the ML layer. Trained on one click via `POST /train`.

| | Naive Model | Pre-Construction Model |
|---|---|---|
| **Feature set** | All columns | Bid-time only |
| **Includes** | delay_days, cost_overrun_pct, safety_incidents | project_type, contract_value, region, sub_count |
| **Accuracy** | ~100% | Lower, varies by dataset |
| **Deployable?** | No — leaks outcome data | Yes |
| **Purpose** | Demonstrates feature leakage | Realistic deployment target |

The UI renders both models with:
- Feature importance bar charts
- Leaky features highlighted in red
- ROC AUC scores
- Inline explanation of why the naive model is invalid

### 4. Document Q&A (RAG Pipeline)

Upload PDFs, DOCX, or TXT files to a portfolio. The entire pipeline runs inside Supabase — no external vector database.

**Ingestion pipeline (fully automated):**
```
PDF/DOCX/TXT upload → Supabase Storage
  → Postgres AFTER INSERT trigger
    → pg_net webhook → embed Edge Function (Deno 2)
      → Text extraction (unpdf / mammoth / TextDecoder)
        → Chunk at ~400 words, 50-word overlap
          → gte-small embedding (384-dim) per chunk
            → INSERT into document_chunks (pgvector)
              → Update documents.status = 'complete'
```

**Query pipeline:**
```
User question → query Edge Function
  → Embed question with gte-small
    → Cosine similarity search (pgvector ivfflat)
      → Filter chunks by similarity threshold
        → Build prompt: context = [C1]...[Ck] citation blocks
          → DeepSeek v3.2 via OpenRouter generates answer
            → UI splits on [Cn] tokens → clickable citation chips
```

**Confidence levels** are derived from the top similarity score:
- **High** — top similarity ≥ 0.7
- **Medium** — top similarity ≥ 0.5
- **Low** — below 0.5

Citation chips scroll to and highlight the matched source card. Source card IDs are namespaced per message to prevent cross-turn collisions.

### 5. Pre-Construction Intake — Screen

The most operationally useful feature. Describe a hypothetical project and get cohort-based outcome estimates derived from your own portfolio history.

**This is not a predictive model.** It is a k-nearest-neighbor (k-NN) algorithm: it finds the k most historically similar projects and reports what actually happened to them. No weights, no training, no black box.

**User inputs:**
- Project type (dropdown, populated from portfolio distinct values)
- Region (dropdown, populated from portfolio distinct values)
- Contract value (USD)
- Subcontractor count
- Cohort size k (1–20, default 5)

**Algorithm:**
1. Feature vector constructed from inputs, normalized against portfolio distribution
2. Euclidean distance computed against all portfolio projects
3. k nearest neighbors selected
4. For each continuous outcome: P25, P50, P75 computed over the cohort
5. For dispute (binary): Wilson score interval used for 95% confidence interval
6. Confidence level assigned based on cohort size

**Confidence thresholds:**
- `low` — fewer than 3 neighbors (insufficient; treat as anecdotal)
- `medium` — 3–9 neighbors
- `high` — 10+ neighbors

**Output panels:**

| Panel | Metric | Display |
|---|---|---|
| Delay (days) | P25 / P50 / P75 | Distribution strip + confidence dot |
| Cost overrun (%) | P25 / P50 / P75 | Distribution strip + confidence dot |
| Safety incidents | P25 / P50 / P75 | Distribution strip + confidence dot |
| Dispute likelihood | Wilson CI rate | Large % + "23%–88% CI" bounds |

The form updates with 400ms debounce. Each keystroke cancels the previous in-flight request via `AbortController` to prevent race conditions.

### 6. Risk Intelligence

Heuristic rule engine that evaluates each project against configurable thresholds stored in `heuristic_rules` and computes per-project risk scores written to `risk_scores`.

### 7. Projects & Anomalies

Full CRUD for project records. The anomaly view surfaces statistical outliers with rule, actual value, and deviation context for analyst review.

---

## System Architecture

Three independent runtimes communicate over HTTPS. Each owns a clear domain:

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────────────┐
│                  Next.js Frontend  (Vercel)                      │
│  App Router · React Server Components · TanStack Query           │
│                                                                  │
│  /api/ml/[...path]  ──────────────────► proxy (stamps auth)     │
│  Supabase JS SDK  ─────────────────────► direct DB + storage    │
└────────────┬──────────────────────────────────┬─────────────────┘
             │ Supabase JS SDK                   │ HTTPS + INTERNAL_API_TOKEN
             │                                   │
┌────────────▼───────────────┐   ┌───────────────▼───────────────┐
│  Supabase  (East US Ohio)  │   │  Python ML Service (Railway)  │
│  ├─ Postgres 17            │   │  FastAPI · pandas · sklearn    │
│  ├─ pgvector (384-dim)     │   │                                │
│  ├─ Storage (50 MiB limit) │   │  POST /ingest   CSV parse+clean│
│  └─ Edge Functions (Deno2) │   │  POST /train    2-model fit    │
│     ├─ embed  (webhook)    │   │  POST /analyze  risk scoring   │
│     └─ query  (JWT)        │   │  POST /simulate k-NN cohort    │
└────────────────────────────┘   └───────────────────────────────┘
```

**Why three runtimes?**

| Runtime | Why it lives here |
|---|---|
| **Vercel (Next.js)** | SSR/ISR, global CDN, zero cold start for UI routes |
| **Railway (Python)** | pandas and scikit-learn require the Python ecosystem; long-running compute jobs are not suited to Edge Functions with their 150ms wall-clock limit |
| **Supabase Edge Functions (Deno)** | Vector operations run co-located with the database — no data leaves the Supabase region for embedding generation, minimizing latency and egress costs |

---

## Tech Stack

### Frontend (`frontend/`)

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.x |
| Language | TypeScript | 5.x |
| UI runtime | React | 19.x |
| Styling | Tailwind CSS | 4.x |
| Component library | shadcn/ui + Base UI | latest |
| Charts | Recharts | 3.x |
| Server state | TanStack Query | 5.x |
| Database client | @supabase/supabase-js | 2.x |
| Schema validation | Zod | 4.x |
| CSV parsing | PapaParse | 5.x |
| File upload | react-dropzone | 15.x |
| Toast notifications | Sonner | latest |

### ML Service (`ml-service/`)

| Layer | Technology |
|---|---|
| Web framework | FastAPI |
| Runtime | Python 3.11+ |
| Data processing | pandas 2.x, NumPy 2.x |
| Machine learning | scikit-learn 1.5+ (LogisticRegression, KNeighborsRegressor) |
| PDF parsing | pypdf 5.x |
| Database client | supabase-py 2.x |
| HTTP client | httpx |
| Linter | Ruff (line-length 100, py311 target) |
| Container | Docker — python:3.11-slim base |

### Infrastructure

| Service | Provider | Purpose |
|---|---|---|
| Frontend hosting | Vercel | SSR, CDN, env vars |
| ML service hosting | Railway | Dockerized Python API, auto-deploy on push |
| Database | Supabase — project `papbpbuayuorqzbvwrnb` | Postgres 17 + pgvector + Storage |
| Edge functions | Supabase Deno 2 | embed, query |
| LLM inference | OpenRouter → DeepSeek v3.2 | RAG answer generation (swappable via env var) |
| Version control | GitHub — `Metdez/enlaye` | Source of truth; push to `main` triggers auto-deploys |

---

## Repository Structure

```
enlaye/
├── frontend/                        # Next.js application
│   ├── app/
│   │   ├── page.tsx                 # Landing page + demo load
│   │   ├── portfolios/
│   │   │   └── [id]/
│   │   │       ├── layout.tsx       # Portfolio shell, sidebar nav
│   │   │       ├── overview/        # Summary dashboard
│   │   │       ├── screen/          # Pre-construction intake (k-NN)
│   │   │       ├── projects/        # CRUD table
│   │   │       ├── anomalies/       # Flagged outlier list
│   │   │       ├── insights/        # Risk intelligence scores
│   │   │       ├── models/          # Two-model comparison
│   │   │       ├── documents/       # Document management
│   │   │       └── ask/             # RAG chat interface
│   │   └── api/
│   │       └── ml/[...path]/
│   │           └── route.ts         # Auth-stamping proxy to ML service
│   ├── components/
│   │   ├── features/                # Page-level interactive components
│   │   │   ├── scenario-simulator.tsx   # Screen feature (k-NN form + results)
│   │   │   ├── document-upload.tsx
│   │   │   ├── document-list.tsx
│   │   │   └── project-form.tsx
│   │   ├── data/                    # Data visualization primitives
│   │   │   ├── distribution-strip.tsx   # P25/P50/P75 horizontal track
│   │   │   └── status-dot.tsx           # Confidence level indicator dot
│   │   ├── shell/                   # Layout, sidebar, navigation
│   │   └── marketing/               # Landing page + Screen showcase
│   └── lib/
│       ├── types.ts                 # Shared TypeScript interfaces
│       ├── format.ts                # Formatters: currency, percent, number
│       └── supabase/                # Client + server Supabase helpers
│
├── ml-service/                      # Python FastAPI service
│   ├── main.py                      # App entry, route registration
│   ├── routers/
│   │   ├── ingest.py                # CSV parse, clean, median imputation, anomaly flag
│   │   ├── train.py                 # Naive + pre-construction model training
│   │   ├── analyze.py               # Heuristic risk scoring
│   │   └── simulate.py              # k-NN cohort simulation
│   ├── Dockerfile                   # python:3.11-slim, Railway $PORT injection
│   ├── requirements.txt
│   └── pyproject.toml               # Python 3.11+, Ruff config
│
├── supabase/                        # Supabase project config
│   ├── config.toml                  # Local dev: API :54321, DB :54322, Studio :54323
│   ├── migrations/                  # Ordered SQL migration files
│   └── functions/
│       ├── embed/index.ts           # Webhook-triggered embedding pipeline
│       └── query/index.ts           # JWT-verified RAG query
│
├── ARCHITECTURE.md                  # System design, schema, API contracts, changelog
├── IMPLEMENTATION.md                # Phase-by-phase build plan + acceptance criteria
├── WORKSTREAMS.md                   # Session log, parallel work tracks, live status
├── CONVENTIONS.md                   # Code patterns, comment protocol, gitignore template
└── CLAUDE.md                        # AI assistant session rules (entry point for Claude Code)
```

---

## Database Schema

Supabase Postgres 17 with the `pgvector` extension enabled. All tables in the `public` schema.

```sql
-- Portfolio container
portfolios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  user_id       uuid,
  created_at    timestamptz DEFAULT now()
)

-- Individual project records (written by /ingest)
projects (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id          uuid REFERENCES portfolios(id) ON DELETE CASCADE,
  project_name          text,
  project_id_external   text,          -- original ID from the CSV
  project_type          text,
  region                text,
  contract_value_usd    numeric,
  subcontractor_count   int,
  delay_days            numeric,
  cost_overrun_pct      numeric,
  safety_incidents      int,
  final_status          text,          -- 'completed' | 'in_progress' | 'cancelled'
  payment_disputes      int,
  is_anomaly            boolean DEFAULT false,
  created_at            timestamptz DEFAULT now()
)

-- ML model training history
model_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id        uuid REFERENCES portfolios(id) ON DELETE CASCADE,
  model_type          text,            -- 'naive' | 'pre_construction'
  accuracy            numeric,
  roc_auc             numeric,
  feature_importance  jsonb,           -- {feature_name: importance_score}
  trained_at          timestamptz DEFAULT now()
)

-- Uploaded documents
documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id   uuid REFERENCES portfolios(id) ON DELETE CASCADE,
  filename       text NOT NULL,
  storage_path   text NOT NULL,        -- path within Supabase Storage bucket
  status         text DEFAULT 'pending', -- 'pending' | 'embedding' | 'complete' | 'error'
  created_at     timestamptz DEFAULT now()
)

-- Vector chunks (RAG retrieval source)
document_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid REFERENCES documents(id) ON DELETE CASCADE,
  content      text NOT NULL,
  embedding    vector(384),            -- gte-small output: 384 dimensions (NOT 1536)
  chunk_index  int,                    -- 0-based position within document
  created_at   timestamptz DEFAULT now()
)

-- Per-project risk scores
risk_scores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  score        numeric,
  factors      jsonb,
  computed_at  timestamptz DEFAULT now()
)

-- Configurable heuristic rule definitions
heuristic_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  uuid REFERENCES portfolios(id) ON DELETE CASCADE,
  rule_name     text,
  field         text,                  -- column name to evaluate
  operator      text,                  -- '>' | '<' | '>=' | '<='
  threshold     numeric,
  created_at    timestamptz DEFAULT now()
)

-- k-means / manual project groupings
project_segments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id   uuid REFERENCES portfolios(id) ON DELETE CASCADE,
  segment_label  text,
  project_ids    uuid[],
  created_at     timestamptz DEFAULT now()
)
```

> **Critical:** `document_chunks.embedding` is `vector(384)`. We use `gte-small`. If you change the embedding model, you must create a new migration to drop and recreate this column and re-embed all existing documents. Do not change the dimension in place.

---

## API Reference

### Python ML Service

All endpoints are JSON in / JSON out. The `INTERNAL_API_TOKEN` header is required on every request — it is stamped server-side by the Next.js proxy and never exposed to the browser.

---

#### `POST /ingest`

Parse and clean a portfolio CSV. Applies median imputation, flags anomalies, writes cleaned rows to `projects`.

```typescript
// Request body
interface IngestRequest {
  portfolio_id: string;   // UUID of an existing portfolio
  csv_content:  string;   // Raw CSV text (UTF-8)
}

// Response body
interface IngestResponse {
  rows_inserted:       number;
  rows_skipped:        number;
  anomalies_flagged:   number;
  columns_imputed:     string[];  // which columns had missing values filled
}
```

---

#### `POST /train`

Train both dispute-prediction models on the cleaned data for a portfolio. Writes results to `model_runs`.

```typescript
// Request body
interface TrainRequest {
  portfolio_id: string;
}

// Response body (one entry per model)
interface TrainResponse {
  naive: ModelResult;
  pre_construction: ModelResult;
}

interface ModelResult {
  model_run_id:        string;
  accuracy:            number;           // 0–1
  roc_auc:             number;           // 0–1
  feature_importance:  Record<string, number>;  // {feature: importance}
}
```

---

#### `POST /analyze`

Run the heuristic rule engine against a portfolio. Computes risk scores and writes to `risk_scores`.

```typescript
interface AnalyzeRequest  { portfolio_id: string }
interface AnalyzeResponse { projects_scored: number; rules_applied: number }
```

---

#### `POST /simulate`

Run the k-nearest-neighbor cohort simulation for the Screen feature. Does not write to the database — pure computation over existing project data.

```typescript
// Request body
interface SimulateRequest {
  portfolio_id:        string;
  project_type:        string;
  region:              string;
  contract_value_usd:  number;
  subcontractor_count: number;
  k?:                  number;   // default 5, clamped to max 20
}

// Response body
interface SimulateResponse {
  cohort_size:         number;    // actual neighbors found (may be < k if portfolio is small)
  k_requested:         number;
  similar_project_ids: string[];  // UUIDs of matched projects, ordered by distance
  outcomes: {
    delay_days:        OutcomeRange;
    cost_overrun_pct:  OutcomeRange;
    safety_incidents:  OutcomeRange;
    any_dispute:       OutcomeRate;
  };
  caveats: string[];   // human-readable warnings (e.g., low cohort size)
}

// Continuous outcome: percentile bands
interface OutcomeRange {
  p25:        number | null;
  p50:        number | null;   // median
  p75:        number | null;
  n:          number;          // cohort rows contributing to this metric
  confidence: "low" | "medium" | "high";
}

// Binary outcome: Wilson score interval
interface OutcomeRate {
  rate:       number | null;   // 0–1
  ci_low:     number | null;   // Wilson 95% CI lower bound
  ci_high:    number | null;   // Wilson 95% CI upper bound
  n:          number;
  confidence: "low" | "medium" | "high";
}
```

**Confidence assignment:**
- `"low"` — `n < 3` (data insufficient; treat as directional only)
- `"medium"` — `3 ≤ n < 10`
- `"high"` — `n ≥ 10`

---

### Supabase Edge Functions

#### `embed` (webhook-triggered, no auth required from caller)

Fires automatically via a Postgres `AFTER INSERT` trigger on the `documents` table, delivered through `pg_net`. Not called directly.

**Behavior:** Fetches the document from Storage → extracts text → chunks at ~400 words with 50-word overlap → generates `gte-small` embeddings → bulk inserts into `document_chunks` → sets `documents.status = 'complete'`.

---

#### `query` (JWT-verified)

```typescript
// Request body
interface QueryRequest {
  portfolio_id: string;
  question:     string;
  top_k?:       number;              // default 5 — number of chunks to retrieve
  threshold?:   number;              // default 0.5 — minimum cosine similarity
}

// Response body
interface QueryResponse {
  answer:    string;
  citations: Citation[];
  confidence: "high" | "medium" | "low";   // derived from top similarity score
}

interface Citation {
  chunk_id:       string;
  document_name:  string;
  excerpt:        string;  // ~200-char preview of the matched chunk
  similarity:     number;  // cosine similarity score (0–1)
}
```

---

## Local Development

### Prerequisites

| Tool | Minimum version | Install |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| Python | 3.11+ | [python.org](https://python.org) |
| Docker Desktop | latest | Required by Supabase local stack |
| Supabase CLI | latest | `npm install -g supabase` |

### Step 1 — Clone and install frontend dependencies

```bash
git clone https://github.com/Metdez/enlaye.git
cd enlaye
cd frontend && npm install && cd ..
```

### Step 2 — Start the Supabase local stack

```bash
supabase start
# Local Postgres → :54322
# Studio (DB browser) → :54323
# REST / Realtime API → :54321
```

Apply all migrations to the local database:
```bash
supabase db reset
```

### Step 3 — Configure environment variables

```bash
cp frontend/.env.local.example frontend/.env.local
cp ml-service/.env.example ml-service/.env
# Fill in values from the Environment Variables section below
```

### Step 4 — Start the Python ML service

```bash
cd ml-service
python -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# → http://localhost:8000
```

### Step 5 — Start the Next.js dev server

```bash
cd frontend
npm run dev
# → http://localhost:3000
```

### Step 6 — Serve Edge Functions locally (optional — needed for RAG)

```bash
supabase functions serve
```

### Quality gates (run before every commit)

```bash
cd frontend
npx tsc --noEmit    # TypeScript — zero errors required
npm run lint        # ESLint
npm run build       # Production build — must pass before reporting done
```

---

## Environment Variables

### `frontend/.env.local`

| Variable | Description | Browser-visible |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project REST URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key — safe for browser, restricted by RLS | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Full DB access — server-side routes only | **Never** |
| `ML_SERVICE_URL` | Base URL of the Python ML service (Railway URL or localhost:8000) | **Never** |
| `INTERNAL_API_TOKEN` | Shared secret — stamped on every proxied ML request | **Never** |

### `ml-service/.env`

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Full DB access — ML service needs to write cleaned data |
| `INTERNAL_API_TOKEN` | Must match the value in `frontend/.env.local` |
| `PORT` | Auto-injected by Railway at runtime — do not hardcode |

> **Rule:** `NEXT_PUBLIC_` prefix = browser-visible. `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_API_TOKEN`, and `OPENROUTER_API_KEY` must never get this prefix.

---

## Deployment

All infrastructure is operated via authenticated CLIs. No dashboard clicks required.

### Frontend → Vercel

```bash
cd frontend
vercel link --yes --project enlaye --scope zh-3135
vercel --prod
```

Subsequent deploys: push to `main`. Vercel auto-deploys on every push.

### ML Service → Railway

```bash
cd ml-service
railway link
railway variables set \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  INTERNAL_API_TOKEN="..."
railway up
```

Subsequent deploys: Railway redeploys on push to `main` via GitHub integration.

### Database → Supabase cloud (`papbpbuayuorqzbvwrnb`)

```bash
# Apply pending migrations to cloud
supabase db push

# Deploy Edge Functions
supabase functions deploy embed
supabase functions deploy query

# Set Edge Function secrets
supabase secrets set OPENROUTER_API_KEY="..."
```

After any new migration file is created locally, run `supabase db push` to apply it to the cloud database.

---

## Key Design Decisions

### Median imputation, not mean
Construction project data contains high-magnitude outliers — a $500M hospital alongside a $2M renovation. Mean imputation on such a distribution would shift every imputed value toward the outlier. Median imputation is robust to outliers and is used throughout the ingest pipeline. The rationale is documented inline wherever imputation occurs.

### Feature leakage is intentional and educational
The naive model is not a mistake. It is the demonstration. Showing a model that achieves 100% accuracy on historical data — and then showing exactly which features make that possible — gives analysts intuition for why naive ML on project history is misleading. The pre-construction model's lower-but-honest accuracy is the point.

### k-NN over a regression model for Screen
Three reasons the Screen feature uses k-nearest-neighbor retrieval rather than a trained regressor:
1. **Interpretability** — users can inspect the actual matched projects, not a black-box score
2. **Graceful degradation** — a small cohort triggers a confidence warning rather than a wrong prediction with false precision
3. **No retraining** — new projects added to the portfolio are immediately available as neighbors; no retrain cycle required

### pgvector dimension fixed at 384
`gte-small` produces 384-dimensional vectors. This is baked into the migration DDL (`vector(384)`). Changing embedding models requires a new migration to drop and recreate the column plus re-embedding all stored documents. There is no in-place migration path.

### Internal API token pattern
The browser never speaks directly to the Python ML service. Every ML request routes through Next.js `/api/ml/[...path]`, which stamps the `INTERNAL_API_TOKEN` header server-side before forwarding. The ML service rejects any request missing this token. This keeps the secret out of the browser and out of network devtools.

### Single-user demo posture
Row-level security is not enforced in the current deployment. The anon key has broad read access to support the demo. Enforcing per-user RLS is the first architectural step before any real customer data is loaded.

---

## Security Model

| Threat | Mitigation |
|---|---|
| ML service exposed to the internet without auth | `INTERNAL_API_TOKEN` required on every request; 401 returned without it |
| Service role key leaking to the browser | Never given `NEXT_PUBLIC_` prefix; only used in server-side Next.js routes |
| OpenRouter API key exposure | Lives in Supabase Edge Function secrets only; never in frontend env |
| LLM spend runaway | OpenRouter spend cap configured at the account level |
| Secrets committed to git | All `.env*` files are gitignored; CI validates clean working tree |
| SQL injection | All DB access via Supabase JS SDK and supabase-py (parameterized queries only) |
| XSS via citation content | Citation text is rendered via React — auto-escaped; no `dangerouslySetInnerHTML` |

---

## Known Limitations

These are intentional constraints of the demo scope, not bugs:

- **No auth / RLS** — single-user demo mode. Anon key with broad access. Not multi-tenant.
- **Small training set** — 9–15 completed rows in the demo dataset. No train/test split; the UI labels it *training* accuracy, not held-out accuracy.
- **Outcome features skip imputation on in-progress rows** — those values don't exist yet; imputing them would bias both models.
- **RAG tuned for short documents** — `gte-small` + ~400-word chunks works well for contracts and reports; hundred-page PDFs will work but answer quality degrades as context gets diluted.
- **No CI beyond auto-deploy** — push to `main` redeploys Vercel and Railway. No test suite gate in the pipeline yet.
- **k-NN cohort size bounded by portfolio size** — if you upload 8 projects and request k=10, you get 8 neighbors. Confidence will be `"medium"` at best.

---

## Further Reading

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Full stack diagram, database schema DDL, API contracts, security model, changelog |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | Phase-by-phase build plan with acceptance criteria and completion status |
| [CONVENTIONS.md](./CONVENTIONS.md) | Code patterns, comment protocol (`// WHY:`, `// NOTE:`, `// SECURITY:`), gitignore template |
| [WORKSTREAMS.md](./WORKSTREAMS.md) | Session-by-session activity log, parallel work tracks, live status |

---

*Built by Zack Hanna — [enlaye.com](https://enlaye.com)*

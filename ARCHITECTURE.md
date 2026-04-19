# ARCHITECTURE.md

> The stable technical blueprint for the Enlaye dashboard. Read before making any structural change. Changes here require a changelog entry at the bottom.

**Related docs:** [CLAUDE.md](./CLAUDE.md) · [IMPLEMENTATION.md](./IMPLEMENTATION.md) · [WORKSTREAMS.md](./WORKSTREAMS.md) · [CONVENTIONS.md](./CONVENTIONS.md)

---

## Contents

1. [System Overview](#system-overview)
2. [The Stack](#the-stack)
3. [Service Boundaries](#service-boundaries)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Database Schema](#database-schema)
6. [API Contracts](#api-contracts)
7. [Security Model](#security-model)
8. [Deployment Topology](#deployment-topology)
9. [Changelog](#changelog)

---

## System Overview

The app has three runtimes (frontend, Python service, Supabase Edge Functions) talking to one shared data layer (Supabase Postgres). The frontend is the only thing users touch. Everything else is called server-to-server, with secrets at each boundary.

```
┌─────────────────┐           ┌──────────────────────────────────┐
│  Browser        │──────────▶│  Next.js @ Vercel                │
│  (user)         │           │  - UI, charts, chat              │
└─────────────────┘           │  - Talks to Supabase via SDK     │
                              └───┬──────────────────┬───────────┘
                                  │                  │
                                  │                  │
                                  ▼                  ▼
                   ┌──────────────────────┐   ┌──────────────────────┐
                   │  Supabase            │   │  Python ML Service   │
                   │  - Postgres+pgvector │   │  @ Railway           │
                   │  - Storage (files)   │   │  - FastAPI           │
                   │  - Auth (optional)   │   │  - pandas, sklearn   │
                   │  - Edge Functions ───┼─┐ │  - Reads/writes      │
                   │    (embed, query)    │ │ │    Supabase          │
                   └──────────────────────┘ │ └──────┬───────────────┘
                                            │        │
                                            │        │ (uses service_role key)
                                            ▼        │
                                    ┌───────────────┐│
                                    │  OpenRouter   │◀
                                    │  → DeepSeek   │
                                    │    v3.2       │
                                    └───────────────┘
```

---

## The Stack

| Layer | Technology | Version | Why |
|---|---|---|---|
| Frontend framework | Next.js (App Router) | 14+ | Server components, built-in API routes, great Vercel integration |
| Language | TypeScript | 5+ | Type safety across frontend and backend contracts |
| Styling | Tailwind CSS + shadcn/ui | latest | Fast, consistent, professional out of the box |
| Charts | Recharts | latest | Good React ergonomics, sufficient for our chart types |
| Data fetching | TanStack Query | v5 | Server state handling, optimistic updates, caching |
| File upload | react-dropzone | latest | Handles drag/drop, file validation |
| Data platform | Supabase | cloud | Postgres + pgvector + Auth + Storage + Edge Functions in one |
| Vector store | pgvector (in Postgres) | - | Co-located with relational data; one less service |
| Embeddings | Supabase AI `gte-small` | built-in | 384 dims, free, runs in Edge Functions, no second vendor |
| ML runtime | Python 3.11 | 3.11+ | Required for pandas/scikit-learn |
| ML framework | FastAPI | latest | Async, auto-generates OpenAPI docs, Pydantic validation |
| ML libs | pandas, scikit-learn, numpy | latest stable | Required by the source assessment |
| PDF parsing | pypdf | latest | For project document ingestion |
| LLM provider | OpenRouter | - | Single API for many models; we route through this |
| LLM model | `deepseek/deepseek-v3.2` | - | Strong reasoning, low cost, suitable for cited RAG answers |
| Frontend host | Vercel | - | Zero-config Next.js deploys |
| Python host | Railway | - | Persistent container, no cold starts, simple GitHub integration |
| CI/CD | GitHub + service webhooks | - | Push to main → Vercel + Railway redeploy automatically |

---

## Service Boundaries

Understanding what runs where — and what crosses a boundary — is the core of avoiding bugs.

### Frontend (Next.js on Vercel)

**Owns:** UI rendering, client-side state, form validation, chart rendering, file upload UI, chat UI.

**Does NOT own:** Any secret that could drain an account. Any business logic the user could bypass. Any pandas code.

**Talks to:**
- Supabase Postgres (reads) via `@supabase/supabase-js` with anon key
- Supabase Storage (upload/download) via SDK
- Python ML service `/ingest` and `/train` endpoints
- Supabase Edge Function `query` for RAG

**Does NOT talk directly to:** OpenRouter (goes through Edge Function), LLM APIs of any kind.

### Python ML Service (FastAPI on Railway)

**Owns:** CSV parsing, data cleaning, anomaly flagging, model training, feature engineering.

**Does NOT own:** User-facing responses (it returns data, not HTML). Authentication (we pass a shared secret or trust the network). LLM calls.

**Talks to:**
- Supabase Postgres (read and write) using `service_role` key
- Supabase Storage (read uploaded CSVs) using `service_role` key

**Runs on:** Railway, single container, keeps warm (no cold starts), auto-deploys from `main`.

### Supabase Edge Functions (Deno/TypeScript)

Two functions, each with one job:

**`embed`** — Database webhook triggered on `documents` insert. Extracts text from the uploaded file, chunks it (~400 tokens with 50 overlap), generates an embedding for each chunk with `Supabase.ai.Session('gte-small')`, writes rows to `document_chunks` with embeddings.

**`query`** — HTTP endpoint called by the frontend chat UI. Flow:
1. Receive `{ portfolio_id, question }`
2. Embed the question with gte-small
3. `SELECT ... FROM document_chunks WHERE portfolio_id = $1 ORDER BY embedding <=> $2 LIMIT $3` (pgvector similarity search)
4. Filter by similarity threshold (default 0.5)
5. If no chunks pass: return `{ answer: null, sources: [], confidence: 'low' }`
6. Build prompt with chunks as context
7. POST to `https://openrouter.ai/api/v1/chat/completions` with `deepseek/deepseek-v3.2` (model id read from `OPENROUTER_MODEL`)
8. Parse response, return `{ answer, sources: [chunk_ids], confidence }`
9. `confidence`: `'high'` if top score ≥ 0.7, else `'medium'`

---

## Data Flow Diagrams

### CSV Upload → Dashboard

```
1. User drops CSV on frontend
2. Frontend uploads file to Supabase Storage (/portfolios/{uuid}/raw.csv)
3. Frontend calls Python /ingest with { portfolio_id, storage_path }
4. Python:
   a. Downloads CSV from Storage
   b. Validates columns against schema
   c. Parses dates, coerces types
   d. Computes median imputation for completed projects only
   e. Inserts rows into `projects` with anomaly flags in JSONB column
   f. Writes cleaning_report to portfolios table
5. Python returns { portfolio_id, row_count, cleaning_report, anomaly_count }
6. Frontend navigates to /portfolios/{id}
7. Dashboard reads from Postgres directly via Supabase SDK
```

### Train Models → Comparison View

```
1. User clicks "Train models" on dashboard
2. Frontend calls Python /train with { portfolio_id }
3. Python:
   a. Reads completed projects from `projects` table
   b. Creates target: has_dispute = payment_disputes >= 1
   c. Trains Model A (naive): all features, encodes categoricals
   d. Trains Model B (pre-construction): only bid-time features
      - project_type, contract_value_usd, region, subcontractor_count
   e. Computes training accuracy + feature importances for both
   f. Inserts two rows into `model_runs` (one per model_type)
4. Python returns { naive: {...}, pre_construction: {...} }
5. Frontend fetches from model_runs table, renders side-by-side comparison
```

### Document Upload → RAG

```
Upload phase:
1. User uploads PDF/DOCX via frontend
2. File goes to Supabase Storage (/portfolios/{uuid}/docs/{filename})
3. Frontend inserts row in `documents` table
4. Database webhook fires → embed Edge Function
5. embed function:
   a. Downloads file from Storage
   b. Extracts text (pypdf for PDF, docx extraction for DOCX)
   c. Chunks text (~400 tokens, 50 overlap)
   d. For each chunk: generate embedding via Supabase.ai.Session('gte-small')
   e. Inserts rows into document_chunks

Query phase:
1. User types question in chat UI
2. Frontend calls query Edge Function
3. (see "query" in Service Boundaries for full flow)
4. Frontend renders answer + citation cards (clickable to show source chunks)
```

---

## Database Schema

This is the source of truth. The migration in `supabase/migrations/` must match this.

```sql
-- ============================================================
-- Enable extensions
-- ============================================================
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- ============================================================
-- Portfolios — each CSV upload becomes a portfolio
-- ============================================================
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cleaning_report jsonb default '{}'::jsonb,
  row_count int default 0,
  anomaly_count int default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- Projects — cleaned rows from the uploaded CSV
-- ============================================================
create table projects (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid references portfolios(id) on delete cascade,
  project_id_external text,              -- e.g. "PRJ001" from the source CSV
  project_name text,
  project_type text,
  contract_value_usd numeric,
  start_date date,
  end_date date,
  region text,
  subcontractor_count int,
  delay_days numeric,
  cost_overrun_pct numeric,
  safety_incidents int,
  payment_disputes int,
  final_status text,                      -- 'Completed' or 'In Progress'
  actual_duration_days int,               -- computed, NULL for in-progress
  anomaly_flags jsonb default '[]'::jsonb -- array of flag names
);

create index on projects(portfolio_id);
create index on projects(final_status);

-- ============================================================
-- Model runs — stores both naive and pre-construction results
-- ============================================================
create table model_runs (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid references portfolios(id) on delete cascade,
  model_type text not null,                -- 'naive' or 'pre_construction'
  accuracy numeric,
  feature_importances jsonb,               -- { feature_name: importance_value }
  features_used text[],                    -- explicit list for the UI to display
  n_training_samples int,
  created_at timestamptz default now(),

  constraint model_type_valid check (model_type in ('naive', 'pre_construction'))
);

create index on model_runs(portfolio_id, model_type);

-- ============================================================
-- Documents — uploaded project documents (PDF, DOCX, TXT)
-- ============================================================
create table documents (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid references portfolios(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  chunk_count int default 0,
  embedding_status text default 'pending',  -- 'pending' | 'complete' | 'failed'
  uploaded_at timestamptz default now()
);

create index on documents(portfolio_id);

-- ============================================================
-- Document chunks — text chunks with embeddings for RAG
-- ============================================================
create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  portfolio_id uuid references portfolios(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  embedding vector(384),                    -- gte-small dimension
  created_at timestamptz default now()
);

-- IVFFlat index for fast cosine similarity search
create index on document_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index on document_chunks(portfolio_id);
```

---

## API Contracts

All types use TypeScript shorthand. The Python service uses matching Pydantic models; the Edge Functions use matching Deno types.

### Python ML Service

#### `GET /health`
Returns `200 OK` with `{ status: "ok", version: string }`. For Railway health checks.

#### `POST /ingest`
```typescript
// Request
{
  portfolio_id: string;   // uuid
  storage_path: string;   // Supabase Storage path to the CSV
}

// Response (200)
{
  portfolio_id: string;
  row_count: number;
  cleaning_report: {
    imputations: Array<{ column: string; n_filled: number; value: number }>;
    type_coercions: Array<{ column: string; from: string; to: string }>;
    rows_rejected: number;
  };
  anomaly_count: number;
}

// Response (400) if CSV is malformed
{ error: string; details?: string; }
```

#### `POST /train`
```typescript
// Request
{
  portfolio_id: string;
}

// Response (200)
{
  naive: {
    model_run_id: string;
    accuracy: number;
    features_used: string[];
    feature_importances: Record<string, number>;
    n_training_samples: number;
  };
  pre_construction: {
    model_run_id: string;
    accuracy: number;
    features_used: string[];
    feature_importances: Record<string, number>;
    n_training_samples: number;
  };
}

// Response (400) if insufficient training data
{ error: string; n_completed_projects: number; minimum_required: number; }
```

### Supabase Edge Function: `query`

#### `POST /functions/v1/query`
```typescript
// Request
{
  portfolio_id: string;
  question: string;
  top_k?: number;               // default 3
  threshold?: number;           // default 0.5
}

// Response (200)
{
  answer: string | null;         // null if no chunks passed threshold
  sources: Array<{
    chunk_id: string;
    document_filename: string;
    similarity: number;
    preview: string;             // first 200 chars of chunk_text
  }>;
  confidence: 'high' | 'medium' | 'low';
}
```

### Supabase Edge Function: `embed` (internal, webhook-triggered)

Receives a Postgres webhook payload on `documents` insert. No public HTTP contract.

---

## Security Model

### Key Hierarchy

| Key | Access Level | Lives Where | Exposure Risk |
|---|---|---|---|
| `SUPABASE_ANON_KEY` | Row-level (with RLS) | Frontend (`NEXT_PUBLIC_`) | Low — designed for browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass RLS, full DB access | Python service env, Edge Function secrets | **High — never browser** |
| `OPENROUTER_API_KEY` | Spend from OpenRouter account | Edge Function secrets only | **High — spend cap in place** |

### RLS Strategy

For MVP: **single-user demo mode.** We do not implement RLS policies; the frontend uses the anon key but effectively has full read access to the demo data. This is noted in the README as a known limitation.

For multi-tenant (future): every table with `portfolio_id` gets a policy `(auth.uid() = portfolios.owner_id)`. Add `owner_id uuid references auth.users(id)` to `portfolios`. The Python service bypasses RLS via `service_role`; that's intentional, the service validates the `portfolio_id` belongs to the requesting user via a middleware check.

### Defense in Depth

- OpenRouter spending cap: **$5** (set in OpenRouter dashboard, not code)
- Python service authenticates `/ingest` and `/train` via a shared bearer token (env var `INTERNAL_API_TOKEN`, passed in `Authorization` header from frontend API route)
- Frontend never calls Python directly — goes through a Next.js API route that adds the bearer token
- All cross-service calls log `portfolio_id` for traceability (not content)

---

## Deployment Topology

```
GitHub (source of truth, single repo: Metdez/enlaye)
  ├── push to main → Vercel deploy (frontend)        [auto, via repo link]
  ├── push to main → Railway deploy (ml-service)     [auto, via repo link]
  └── `supabase db push` + `supabase functions deploy` → Supabase
                                                     [run from local, no CI]
```

Three services, one repo. All config is environment-variable driven. **All infrastructure is CLI-driven** — `vercel`, `railway`, `gh`, and `supabase` CLIs are all installed, authenticated, and linked. The AI assistant runs every deploy, env-var update, secret rotation, migration, and webhook setup from the terminal. The human is not asked to click through any dashboard.

**Preview environments:** Vercel gives free preview deploys per PR. Railway does not by default on free tier. For this project we don't bother with preview environments — main → prod directly, demo data pre-loaded, rollback by reverting the commit (`gh` CLI handles the revert PR).

---

## Changelog

Every time ARCHITECTURE.md changes, add an entry here. Date, change, reason.

- **2026-04-18** — Deployment topology updated: all infrastructure (Supabase, Vercel, Railway, GitHub) is now CLI-driven; LLM model swapped from `minimax/minimax-m2.5:free` to `deepseek/deepseek-v3.2`.
- **2026-04-18** — Initial architecture document created.

<!-- Add new entries above this line, newest first -->

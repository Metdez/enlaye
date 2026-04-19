# Enlaye — Construction Risk Dashboard

> Upload a CSV of construction projects. Get a cleaned dataset, flagged anomalies, summary charts, two side-by-side risk models, and a citation-backed chat over your project documents — in under a minute.

**Live demo:** https://enlaye-five.vercel.app/

<!-- TODO: add screenshot.png — top-of-fold dashboard hero, ideally showing the two-model comparison -->

---

## TL;DR

- **Input:** a CSV of projects (or the one-click demo dataset).
- **Output:** a clean portfolio view, flagged risks, a two-model comparison that exposes feature leakage, and a RAG chat over your uploaded docs.
- **Stack:** Next.js + Supabase (Postgres / pgvector / Edge Functions) + FastAPI + scikit-learn + DeepSeek v3.2.
- **Deployed on:** Vercel, Railway, Supabase Cloud.

---

## Core features

| Feature | What it does | Why it matters |
|---|---|---|
| **CSV Ingest & Cleaning** | Parses, coerces types, median-imputes missing values on *completed* rows only, flags four categories of anomaly. | Shows transparent data handling — every transformation is visible in the cleaning report. |
| **Portfolio Dashboard** | Totals, completed-vs-in-progress split, delay + cost-overrun charts by project type, region donut. | A reviewer understands the portfolio in 10 seconds. |
| **Anomaly Detection** | Flags cost overruns > 25%, delays > 150 days, safety incidents ≥ 5, disputes ≥ 5. | Each flagged project surfaces the exact rule + value + threshold. |
| **Two-Model Comparison** *(the showcase)* | Trains a **naive** model (uses leaky post-hoc features) and a **pre-construction** model (bid-time features only) side by side. | The naive model scores ~100%. The pre-construction model is the one you could actually deploy. The UI makes the leakage story visible without reading code. |
| **RAG Chat** | Upload PDF / DOCX / TXT project documents, ask natural-language questions, get cited answers. | Turn a pile of change orders, safety reports, and status memos into a queryable knowledge base. |
| **Retrieval tuning** | Live sliders for `top_k` and similarity threshold. | Lets you feel how retrieval parameters change answer quality in real time. |

---

## The showcase: why two models?

The assessment has a trap baked in. The most "predictive" features — `delay_days`, `cost_overrun_pct`, `safety_incidents` — only exist **after** a project finishes. Any model trained on them scores near 100% and is useless at bid time.

Enlaye trains both models on the same rows and renders them side by side:

- **Model A — Naive.** All features. Leaky ones highlighted in red. Training accuracy ≈ 100%. Looks impressive. Cannot be deployed.
- **Model B — Pre-construction.** Only features available at bid time: `project_type`, `contract_value_usd`, `region`, `subcontractor_count`. Lower accuracy. Actually useful.

**This is the product.** The UI physically shows *why* one model is theater and the other is decision support.

---

## How it works (step by step)

```
 ┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
 │ 1. Upload   │ -> │ 2. Clean &   │ -> │ 3. Dashboard │ -> │ 4. Train     │
 │    CSV      │    │    flag      │    │    & charts  │    │    models    │
 └─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                                                                   │
 ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
 │ 7. Cited     │ <- │ 6. RAG query │ <- │ 5. Upload    │ <────────┘
 │    answer    │    │    + rerank  │    │    docs      │
 └──────────────┘    └──────────────┘    └──────────────┘
```

1. **Upload CSV** — drag a file into the homepage, or click *Load demo data*. Next.js puts the raw file into Supabase Storage, then calls the FastAPI `/ingest` endpoint.
2. **Clean & flag** — FastAPI parses, coerces dates and numerics, median-imputes missing values on completed rows only, flags anomalies by rule, and writes rows + a cleaning report to Postgres.
3. **Dashboard** — `/portfolios/[id]` renders the portfolio: contract value, delay / overrun charts by project type, region donut, an anomaly list, a projects table with pill badges.
4. **Train models** — one button trains both a naive and a pre-construction logistic regression on the completed rows; results and feature importances are written to `model_runs` and rendered side by side.
5. **Upload docs** — drop PDFs, DOCX, or TXT files into the document uploader. A Postgres `AFTER INSERT` trigger fires a `pg_net` webhook to the `embed` Edge Function.
6. **RAG query** — the `embed` function extracts text, chunks at ~400 words with 50-word overlap, embeds each chunk with `gte-small`, and stores vectors in pgvector. The `query` function embeds the user's question, runs a cosine similarity search, filters by threshold, and sends a prompt with retrieved chunks to DeepSeek v3.2 via OpenRouter.
7. **Cited answer** — the model returns an answer with `[C1]`, `[C2]` citations. The UI renders each chip as a clickable button that scrolls to the source chunk and flashes a ring around it. Confidence badge (high / medium / low) is derived from the top similarity score.

---

## How the RAG works

The RAG pipeline is **fully in-Supabase** — no separate vector DB, no separate embedding server.

```
Document uploaded to Storage
        │
        ▼
Insert row into `documents` table
        │
        ▼ (Postgres AFTER INSERT trigger)
`pg_net` POST to `embed` Edge Function
        │
        ▼
Extract text (unpdf | mammoth | TextDecoder)
        │
        ▼
Chunk (~400 words, 50 overlap)
        │
        ▼
Embed each chunk — Supabase.ai.Session('gte-small')  [384-dim]
        │
        ▼
Insert into `document_chunks` (pgvector ivfflat cosine index)
        │
        ▼
`documents.embedding_status` → 'complete'
```

**On a query:**

1. Frontend POSTs `{ question, top_k, threshold }` to the `query` Edge Function.
2. The function embeds the question with the same `gte-small` model.
3. A `match_document_chunks` SQL function runs a cosine similarity search using the ivfflat index, filters by threshold, returns the top-k chunks.
4. A prompt is assembled with the chunks numbered `[C1]..[Ck]` and explicit citation instructions.
5. DeepSeek v3.2 (via OpenRouter) generates an answer with inline `[Cn]` references.
6. The response payload carries `{ answer, sources, confidence }`; confidence is derived from the top similarity (high ≥ 0.7, medium ≥ 0.5, low below).
7. The UI splits the answer on `/\[C(\d+)\]/g`, rendering each citation as a button that scrolls to and highlights the corresponding source chunk.

**Tuning surface:** the chat UI exposes `top_k` and `threshold` as sliders — a reviewer can feel in real time how retrieval tightness changes answer quality.

---

## What it's built with

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui, Recharts | Server components for dashboard reads, client components only where needed (upload, chat, training button). |
| **Data** | Supabase — Postgres + pgvector + Storage + Edge Functions | One platform for DB, vector search, file storage, and serverless compute. No separate vector DB. |
| **ML service** | Python 3.11 / FastAPI on Railway, pandas + scikit-learn | Logistic regression for interpretability on a tiny dataset. No train/test split on 9 rows — that would be theater. |
| **Embeddings** | Supabase AI `gte-small` (384-dim, in-Edge-Function) | No external embedding API call, no extra latency, no extra bill. |
| **LLM** | DeepSeek v3.2 via OpenRouter | Strong instruction-following at low cost; swappable via one env var. |
| **Hosting** | Vercel (frontend) + Railway (ML) + Supabase Cloud (data) | Each runtime on the platform that fits it best. Auto-deploy on push. |

Full architecture, schema, API contracts, and security model: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Try it in 30 seconds

1. Open https://enlaye-five.vercel.app/
2. Click **Load demo data** (or drop your own CSV).
3. On the portfolio page, click **Train Models** — watch the two-model comparison render.
4. Upload a demo PDF / TXT from `frontend/public/demo-docs/`.
5. Ask *"What safety incidents happened on Project Alpha?"* in the chat.

---

## Local setup

Three runtimes: frontend, ML service, Supabase.

```bash
# 1. Frontend
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, etc.
npm install
npm run dev                         # → http://localhost:3000

# 2. ML service (second terminal)
cd ml-service
cp .env.example .env                # SUPABASE_URL, SERVICE_ROLE_KEY, INTERNAL_API_TOKEN
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. Supabase (third terminal — local Postgres + Studio)
supabase start
supabase db reset                   # apply migrations to local DB
supabase functions serve            # serve embed/query Edge Functions locally
```

Required tools: Node 20+, Python 3.11+, Supabase CLI, Docker. Prod deploy cheatsheet: [CLAUDE.md § Common Commands](./CLAUDE.md#common-commands).

---

## Repo layout

```
.
├── frontend/          # Next.js 14 — UI, charts, chat, file upload
├── ml-service/        # FastAPI — CSV cleaning, model training, anomaly flagging
├── supabase/
│   ├── migrations/    # SQL schema, RLS policies, Storage buckets, webhooks
│   └── functions/     # Edge Functions: `embed`, `query`
├── ARCHITECTURE.md    # Stack, schema, API contracts, security model
├── IMPLEMENTATION.md  # Phase-by-phase build plan with acceptance criteria
├── CONVENTIONS.md     # Code patterns, comment protocol, gitignore template
├── WORKSTREAMS.md     # Session log and live status
└── CLAUDE.md          # Session entry point and operating rules
```

---

## Known limitations

Deliberate scope choices for a single-user demo, not bugs.

- **No auth, no RLS.** Frontend reads with the anon key. Multi-tenant RLS is sketched in [ARCHITECTURE.md § Security Model](./ARCHITECTURE.md#security-model) but not wired.
- **Tiny training set.** 9 completed projects in the demo. No train/test split — the UI labels the number as *training* accuracy. Cross-validation on 9 rows would overfit worse than reporting it honestly.
- **In-progress rows skip outcome imputation.** `safety_incidents` and `payment_disputes` are not imputed for in-progress projects — those signals don't exist yet, and filling them with the completed median would invent data.
- **RAG is sized for small docs.** `gte-small` + ~400-word chunks are tuned for short project documents. Hundred-page PDFs will work but retrieval quality degrades.
- **No CI beyond auto-deploy.** Push to `main` triggers Vercel + Railway redeploys; no GitHub Actions.

---

## Further reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — stack, schema, data flow, API contracts, security, deployment
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — phase-by-phase build log with acceptance criteria
- [CONVENTIONS.md](./CONVENTIONS.md) — code patterns, comment protocol, error handling
- [WORKSTREAMS.md](./WORKSTREAMS.md) — session-by-session activity log

# Enlaye

### Construction risk, from raw CSV to cited answers — in under a minute.

**[→ Try the live demo](https://enlaye-five.vercel.app/)**

<!-- TODO: add screenshot.png — top-of-fold dashboard hero, ideally showing the two-model comparison -->

---

## What is this?

A web dashboard for construction portfolio analysts. **Upload a CSV. Get risk.**

- 📊 **Clean & flag** — auto-clean messy project data, flag cost overruns, delays, safety incidents, disputes.
- 📈 **Visualize** — portfolio KPIs, delay/overrun charts, region donut — dashboard-ready in one click.
- 🤖 **Two risk models** — side-by-side: a naive model (100% accurate, useless) vs. a pre-construction model (lower accuracy, actually deployable). **This is the showcase.**
- 💬 **Ask your docs** — drop PDFs, DOCX, or TXT. Ask questions. Get cited answers.

---

## The 30-second pitch

> Most construction risk tools hide their math. This one makes the math the product.
>
> The "Train Models" button trains **two** models on the same data — one with every feature, one with only bid-time features — and renders them side by side. The first scores ~100% and is **useless** (it uses features that don't exist until after a project finishes). The second scores lower but is the one you'd actually deploy.
>
> The UI shows *why*. That's the whole point.

---

## What you can do in 60 seconds

1. Open the [live demo](https://enlaye-five.vercel.app/).
2. Click **Load demo data** → instant 15-row portfolio.
3. Click **Train Models** → two models render side by side with leakage visualized.
4. Drop a PDF in the documents tab → wait for it to embed.
5. Ask *"What safety incidents happened on Project Alpha?"* → get a cited answer with clickable sources.

---

## Core features

| Feature | What it does |
|---|---|
| **CSV Ingest** | Drag-drop CSV → parsed, type-coerced, median-imputed (completed rows only), anomalies flagged. |
| **Portfolio Dashboard** | KPI tiles, delay + overrun charts by project type, region donut, anomaly list. |
| **Anomaly Flags** | Overruns >25%, delays >150d, safety ≥5, disputes ≥5 — each flag shows the rule + actual value + threshold. |
| **Two-Model Comparison** *(the showcase)* | Trains naive + pre-construction models on one click. Leaky features in red. Feature importance bars. |
| **RAG Chat** | Upload PDFs / DOCX / TXT → ask questions → cited answers with clickable source chips. |
| **Retrieval tuning** | Live sliders for `top_k` and similarity threshold — feel how retrieval changes answer quality. |

---

## How it works

```
  UPLOAD ─────► CLEAN ─────► DASHBOARD ─────► TRAIN MODELS
    CSV          FastAPI       Next.js         scikit-learn
                 Supabase      Recharts        (2 models)
                 Postgres

  UPLOAD ─────► EMBED ──────► QUERY ──────► CITED ANSWER
    DOCS         Edge Fn       pgvector      DeepSeek v3.2
                 gte-small     top-k         via OpenRouter
                 (384-dim)     similarity
```

**Data pipeline (steps 1-4):**
1. Drop a CSV on the homepage.
2. Next.js uploads it to Supabase Storage, calls the Python `/ingest` endpoint.
3. FastAPI cleans, imputes, flags anomalies, writes rows + cleaning report to Postgres.
4. Next.js server components render the dashboard from Postgres.

**Model training (step 5):**
5. **Train Models** button → FastAPI `/train` runs two `LogisticRegression` fits: one with all features (including leaky `delay_days`, `cost_overrun_pct`, `safety_incidents`), one restricted to bid-time features (`project_type`, `contract_value_usd`, `region`, `subcontractor_count`). Both results land in `model_runs`.

**RAG pipeline (steps 6-9):**
6. Upload a document → Postgres `AFTER INSERT` trigger → `pg_net` webhook → `embed` Edge Function.
7. `embed` extracts text (unpdf / mammoth / TextDecoder), chunks at ~400 words with 50 overlap, generates `gte-small` embeddings, writes chunks to pgvector.
8. User asks a question → `query` Edge Function embeds the question, runs cosine similarity against pgvector, filters by threshold, builds a prompt with `[C1]..[Ck]` citations.
9. DeepSeek v3.2 returns a cited answer → UI splits on `[Cn]` tokens, renders each as a clickable chip that scrolls to and highlights the source.

---

## How the RAG works (deeper dive)

**In-Supabase, end to end.** No separate vector DB, no external embedding API.

```
  Document → Storage
       │
       ▼ (Postgres AFTER INSERT trigger)
  pg_net webhook → embed Edge Function
       │
       ▼
  Extract text → Chunk (~400 words, 50 overlap)
       │
       ▼
  Embed (Supabase.ai gte-small, 384-dim)
       │
       ▼
  Insert into document_chunks (pgvector ivfflat cosine)
       │
       ▼
  embedding_status = 'complete'
```

**Query-time confidence** is derived from the top similarity score: **high ≥ 0.7**, **medium ≥ 0.5**, **low below**. The UI renders a colored dot + label so confidence isn't color-only (a11y).

**Citation UX** — answers contain `[C1]`, `[C2]` tokens. A regex splits them into clickable chips; each chip scrolls to and rings the matching source card. Source card IDs are namespaced per message to avoid cross-turn collisions.

---

## Built with

| Layer | Stack |
|---|---|
| **Frontend** | Next.js 14 App Router · TypeScript · Tailwind · shadcn/ui · Recharts |
| **Data** | Supabase — Postgres + pgvector + Storage + Edge Functions |
| **ML** | Python 3.11 · FastAPI · pandas · scikit-learn |
| **Embeddings** | Supabase AI `gte-small` (384-dim, runs inside Edge Functions) |
| **LLM** | DeepSeek v3.2 via OpenRouter (swappable via one env var) |
| **Hosting** | Vercel (frontend) · Railway (ML) · Supabase Cloud (data) |

Full architecture, schema, API contracts: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Local setup

```bash
# 1. Frontend
cd frontend && cp .env.local.example .env.local && npm install && npm run dev

# 2. ML service (second terminal)
cd ml-service && cp .env.example .env && pip install -r requirements.txt && uvicorn main:app --reload --port 8000

# 3. Supabase (third terminal)
supabase start && supabase db reset && supabase functions serve
```

Required: Node 20+, Python 3.11+, Supabase CLI, Docker.

---

## Repo layout

```
.
├── frontend/          # Next.js 14 — UI, charts, chat, uploads
├── ml-service/        # FastAPI — cleaning, training, anomaly flagging
├── supabase/
│   ├── migrations/    # SQL schema, RLS, buckets, webhooks
│   └── functions/     # embed, query Edge Functions
└── docs/              # ARCHITECTURE · IMPLEMENTATION · CONVENTIONS · WORKSTREAMS
```

---

## Known limits (by design)

Single-user demo. Not a multi-tenant product.

- **No auth / RLS** — anon key, demo data is public.
- **Tiny training set** — 9 completed rows. No train/test split; UI labels it *training* accuracy.
- **Outcome features skip imputation on in-progress rows** — those signals don't exist yet; inventing them would bias the model.
- **RAG tuned for short docs** — `gte-small` + ~400-word chunks; hundred-page PDFs work but quality degrades.
- **No CI beyond auto-deploy** — push to `main` redeploys Vercel + Railway.

---

## Further reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — stack, schema, data flow, security model
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — phase-by-phase build log
- [CONVENTIONS.md](./CONVENTIONS.md) — code patterns, comment protocol
- [WORKSTREAMS.md](./WORKSTREAMS.md) — session-by-session activity log

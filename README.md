# Enlaye — Construction Risk Dashboard

<!-- TODO: add screenshot.png — top-of-fold dashboard hero, ideally showing the two-model comparison -->

A web dashboard for construction risk analysts. Upload a CSV of projects, get a cleaned dataset with anomalies flagged, summary charts, two dispute-prediction models trained side-by-side (the showcase: naive vs. pre-construction, demonstrating feature leakage), and a chat interface for natural-language questions over uploaded project documents (RAG).

**Live demo:** https://enlaye-five.vercel.app/

---

## Why I built this

This started as a 120-minute internship assessment: clean a 15-row CSV, flag anomalies, train a dispute-prediction model, and answer a few RAG-style questions. The assessment has an obvious trap baked in — the most predictive features (`delay_days`, `cost_overrun_pct`, `safety_incidents`) only exist *after* a project finishes, so any model that uses them is useless at bid time. Most submissions train one model on everything and report 100% accuracy.

This repo is the product the assessment was pointing at: a dashboard that trains both models, puts them side-by-side, and explains why one is theater and the other is the actual decision-support tool a PM would use.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui, Recharts |
| Backend (data) | Supabase — Postgres + pgvector + Storage + Edge Functions |
| Backend (ML) | Python 3.11 / FastAPI on Railway, pandas + scikit-learn |
| Embeddings | Supabase AI `gte-small` (384-dim, in-Edge-Function) |
| LLM | DeepSeek v3.2 via OpenRouter |
| Hosting | Vercel (frontend) + Railway (ML) + Supabase Cloud (data) |

Full architecture, schema, API contracts, and security model: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## How the showcase works

The "Train Models" button trains two models on the same completed-project rows. **Model A (naive)** uses every numeric and categorical feature, including outcome features like `delay_days` — it scores ~100% accuracy and is useless. **Model B (pre-construction)** uses only features available at bid time (`project_type`, `contract_value_usd`, `region`, `subcontractor_count`) — it scores lower but is the model you could actually deploy. The UI renders them side-by-side with leaky features highlighted in red, so the leakage story is visible without reading code.

---

## Local setup

Three runtimes (frontend, ML service, Supabase). Minimum bootstrap:

```bash
# 1. Frontend
cd frontend
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, etc.
npm install
npm run dev                         # → http://localhost:3000

# 2. ML service (in a second terminal)
cd ml-service
cp .env.example .env                # fill in SUPABASE_URL, SERVICE_ROLE_KEY, INTERNAL_API_TOKEN
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. Supabase (in a third terminal — local Postgres + Studio)
supabase start
supabase db reset                   # apply migrations to local DB
supabase functions serve            # serve embed/query Edge Functions locally
```

Required tools: Node 20+, Python 3.11+, Supabase CLI, Docker (for `supabase start`).

For prod deploy commands and CLI cheatsheet, see [CLAUDE.md § Common Commands](./CLAUDE.md#common-commands).

---

## Repo layout

```
.
├── frontend/          # Next.js 14 app — UI, charts, chat, file upload
├── ml-service/        # FastAPI — CSV cleaning, model training, anomaly flagging
├── supabase/
│   ├── migrations/    # SQL schema, RLS policies, Storage buckets, webhooks
│   └── functions/     # Edge Functions: `embed` (doc → chunks), `query` (RAG)
├── ARCHITECTURE.md    # Stack, schema, API contracts, security model
├── IMPLEMENTATION.md  # Phase-by-phase build plan with acceptance criteria
├── CONVENTIONS.md     # Code patterns, comment protocol, gitignore template
├── WORKSTREAMS.md     # Session log and live status
└── CLAUDE.md          # Session entry point and operating rules
```

---

## Known limitations

This is a single-user demo, not a multi-tenant product. The constraints below are deliberate scope choices, not bugs.

- **No auth, no RLS.** The frontend reads with the anon key and effectively has full access to demo data. Multi-tenant RLS policies are sketched in [ARCHITECTURE.md § Security Model](./ARCHITECTURE.md#security-model) but not implemented.
- **Tiny training set.** The demo CSV has 9 completed projects. There is no train/test split — the accuracy reported in the UI is *training* accuracy, and the UI labels it as such. Cross-validation on 9 rows would overfit worse than reporting the naive number honestly.
- **In-progress projects skip outcome imputation.** `safety_incidents` and `payment_disputes` are NOT median-imputed for in-progress rows. Those signals don't exist until a project closes; filling them with the completed-project median would invent data.
- **RAG is sized for small PDFs.** `gte-small` embeddings (384-dim) and ~400-token chunks are tuned for short project docs. Large multi-hundred-page PDFs will work but retrieval quality degrades.
- **No CI beyond auto-deploy.** Push to `main` triggers Vercel + Railway redeploys. There are no GitHub Actions; the `supabase` CLI is run from a developer machine for migrations and Edge Function deploys.

---

## Further reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — stack, schema, data flow, API contracts, security model, deployment topology
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — phase-by-phase build log with acceptance criteria
- [CONVENTIONS.md](./CONVENTIONS.md) — code patterns, comment protocol, error handling
- [WORKSTREAMS.md](./WORKSTREAMS.md) — session-by-session activity log

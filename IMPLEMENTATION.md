# IMPLEMENTATION.md

> Phase-by-phase build plan. Every task has acceptance criteria. Check off `[x]` as you complete them. If a task is harder than expected or gets rescoped, add a note below it — don't silently change the plan.

**Related docs:** [CLAUDE.md](./CLAUDE.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [WORKSTREAMS.md](./WORKSTREAMS.md) · [CONVENTIONS.md](./CONVENTIONS.md)

---

## How to Use This File

- Work top-down. Each phase gates the next.
- A phase is **complete** when every box is `[x]` AND the acceptance criteria at the phase bottom are met.
- When you finish a task, check it off here AND log the session in WORKSTREAMS.md.
- If you discover something missing, add it as a new task with `[ ]` and a note — don't rework the plan unilaterally.
- For parallel work across phases, see [WORKSTREAMS.md](./WORKSTREAMS.md).

---

## Phase 0: Bootstrap (triggered by "get started")

Goal: scaffold the repo and all three runtimes. No feature code.

- [x] Verify local tools: Node 20+, Python 3.11+, git, supabase CLI
- [x] `git init` and create `.gitignore` (see CONVENTIONS.md § Gitignore Template)
- [x] Create folder structure: `frontend/`, `ml-service/`, `supabase/`
- [x] Scaffold Next.js in `frontend/` with TypeScript + Tailwind + App Router
- [x] Install frontend deps: `@supabase/supabase-js @supabase/ssr @tanstack/react-query recharts react-dropzone papaparse zod`
- [x] Initialize shadcn/ui with `npx shadcn@latest init`
- [x] Scaffold Python FastAPI in `ml-service/` with `main.py`, `requirements.txt`, `Dockerfile`
- [x] Add Python deps: `fastapi uvicorn pandas scikit-learn numpy pydantic python-multipart python-dotenv supabase pypdf python-docx`
      <!-- NOTE: skipped `python-multipart` (unused at Phase 0) and `python-docx` (replaced with pypdf only for now; DOCX handling added in Phase 5 if needed). -->
- [x] `supabase init` and verify `supabase/` directory created
- [x] Create `.env.local` template in frontend, `.env.example` in ml-service
      <!-- NOTE: wrote real `.env.local` and `.env` derived from root `.env` (all gitignored). Formal `.env.example` templates to be added before first public push. -->
- [x] First commit: `chore: initial scaffold`
- [x] Update WORKSTREAMS.md § Session Log

**Acceptance:** `npm run dev` works (shows Next.js default page), `uvicorn main:app` works (responds to `/health`), `supabase start` works, no secrets in git.

---

## Phase 1: Foundation (Schema + Wiring)

Goal: the three runtimes can talk to each other and to the database. Still no user-facing features.

- [x] Create first migration with all tables from ARCHITECTURE.md § Database Schema
      <!-- NOTE: added NOT NULL to portfolio_id / document_id FKs after adversarial review. -->
- [x] Run migration locally: `supabase db reset`
- [x] Run migration on remote: `supabase db push`
- [x] Frontend: create `lib/supabase.ts` client using env vars
      <!-- NOTE: exposes `createBrowserSupabase()` + async `createServerSupabase()` (cookies-aware). -->
- [x] Frontend: verify a basic page can read from `portfolios` table (even if empty)
- [x] ML service: add Supabase client setup in `main.py` using service_role key
- [x] ML service: `/health` endpoint returns `{ status: "ok", db_reachable: true }` after testing DB connection
      <!-- NOTE: now returns 503 when DB probe fails (readiness semantics). -->
- [x] Frontend: create a Next.js API route `/api/ml/*` that proxies to Python service with bearer token
      <!-- NOTE: hard-allowlists health/ingest/train; FastAPI /docs/redoc/openapi disabled. -->
- [x] Vercel: `vercel link --yes`, then `vercel env add` for each `NEXT_PUBLIC_*` var (CLI, no dashboard)
      <!-- NOTE: project `enlaye` under zh-3135s-projects; NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, INTERNAL_API_TOKEN, ML_SERVICE_URL all set for production. -->
- [x] Railway: `railway init` (or `railway link`), then `railway variables set KEY=value` for service env (CLI, no dashboard)
      <!-- NOTE: project `enlaye-ml-service` / service `ml-service`; public URL https://ml-service-production-513e.up.railway.app. -->
- [x] `git push origin main` — verify Vercel and Railway auto-build via `vercel logs` and `railway logs`
      <!-- NOTE: Railway was created as empty service (not GH-linked) so ML deploys run via `railway up --detach` from CLI. Vercel deployed via `vercel --prod`; GH integration can be wired later if desired. First deploy 404'd because project had framework=null — fixed by adding `frontend/vercel.json` with `"framework": "nextjs"`. -->
- [x] Curl-check prod URLs (`/` for frontend, `/health` for ml-service)
      <!-- NOTE: https://enlaye-five.vercel.app/ → 200; /api/ml/health → 200 {db_reachable:true}; /api/ml/docs and /api/ml/openapi.json → 404 (allowlist working). Railway: https://ml-service-production-513e.up.railway.app/health → 200. -->


**Acceptance:** Prod frontend loads a page that reads from the prod DB. Prod Python service `/health` responds. Commit messages follow convention (see CONVENTIONS.md).

---

## Phase 2: CSV Ingest (the MVP backbone)

Goal: a user can upload the assessment CSV and see the 15 rows in a table. Cleaning happens, anomalies are flagged, but nothing is pretty yet.

- [x] ML service: implement CSV parsing and type coercion in `cleaning.py`
- [x] ML service: implement median imputation (completed-only) with inline `WHY` comment
      <!-- NOTE: safety_incidents / payment_disputes are NOT imputed on in-progress rows — outcome signals don't exist until the project is done. -->
- [x] ML service: implement anomaly flagging per Task 1c spec (cost_overrun > 25, delay > 150, safety >= 5, disputes >= 5)
- [x] ML service: implement `/ingest` endpoint per ARCHITECTURE.md § API Contracts
      <!-- NOTE: canonical storage_path enforcement (`portfolios/<portfolio_id>/raw.csv`) added after Codex review caught cross-ingest risk. Snapshot-based metadata recovery wraps the non-atomic delete/insert/update trio; proper Postgres RPC transaction deferred to multi-user phase. -->
- [x] ML service: write a quick pytest for cleaning on the 15-row sample
      <!-- NOTE: 21 tests total (9 cleaning + 12 ingest), all passing against local Supabase. -->
- [x] Frontend: build upload page at `/` with react-dropzone
- [x] Frontend: on drop, upload to Supabase Storage then call `/api/ml/ingest`
      <!-- NOTE: `lib/supabase.ts` split into server + `lib/supabase-browser.ts` — the original re-export dragged `next/headers` into client bundles. -->
- [x] Frontend: create `/portfolios/[id]` page that renders projects in a table
- [x] Frontend: show anomaly flags as colored pill badges in the table
- [x] Frontend: show cleaning_report as a collapsible panel ("15 rows loaded, 3 values imputed, 5 anomalies flagged")
- [x] Add the assessment's 15-row CSV as a demo dataset accessible via a "Load Demo Data" button

**Acceptance:** Upload the assessment CSV, land on a dashboard page, see 15 rows with proper types, anomaly flags visible, cleaning transparency visible. ✅ Verified prod at https://enlaye-five.vercel.app/.

**This is the MVP stopping point.** If time runs out, everything from here down can be cut and you still have something legitimate.

---

## Phase 3: Summary Dashboard

Goal: the portfolio overview looks like a real dashboard, not a debug view.

- [x] Frontend: build a `PortfolioSummary` component with:
  - [x] Total contract value, completed vs in-progress count, avg delay
  - [x] Bar chart: mean delay days by project type (Recharts)
  - [x] Bar chart: mean cost overrun % by project type
  - [x] Pie or donut: projects by region
      <!-- NOTE: aggregations live in useMemo inside the client component; per-chart empty-state fallback ("Not enough data to chart.") if a bucket yields zero data. Portfolio-level empty state short-circuits all charts. -->
- [x] Frontend: build an `AnomalyList` component: each flagged project as a card with the specific rule triggered
      <!-- NOTE: server component. Sorts descending by flag count, stable on original order. Per-rule cards embed actual value + threshold ("32.1% overrun (threshold 25%)"). Palette mirrors anomaly-pill.tsx; FLAG_MAP duplicated locally to keep parallel agents from stomping each other. -->
- [x] Frontend: make the main dashboard layout with sidebar nav and content area
      <!-- NOTE: DashboardShell (server). Sticky top header + CSS-only responsive sidebar (vertical on md+, horizontal pills on mobile). Nav items: Overview/Projects/Anomalies + disabled Documents/Models with Phase-coming tooltips. Exports EmptyState primitive for future use. -->
- [x] Style pass: consistent spacing, a proper header, empty states for no-data
- [x] Ensure mobile responsive (at least gracefully degraded)

**Acceptance:** Dashboard looks like something you'd actually send to a reviewer. Someone seeing it for the first time can understand what they're looking at in 10 seconds. ✅ Verified prod at https://enlaye-five.vercel.app/.

---

## Phase 4: The Two-Model Comparison (the showcase)

Goal: the feature that turns this from "dashboard" into "you understood the assessment."

- [x] ML service: implement `cleaning.py` helpers for categorical encoding (one-hot for project_type and region)
      <!-- NOTE: one-hot encoding lives in `models.py` (via `pd.get_dummies`) rather than `cleaning.py`. Rationale: cleaning is DB-insert-shaped (columns match `projects` schema), whereas encoding is model-frame-shaped. Separating them keeps cleaning deterministic and schema-faithful. -->
- [x] ML service: implement `models.py`:
  - [x] `train_naive_model(df)` — uses all numeric + encoded categoricals from completed projects
  - [x] `train_pre_construction_model(df)` — uses ONLY [project_type, contract_value_usd, region, subcontractor_count]
  - [x] Both return `{accuracy, features_used, feature_importances}` (plus `n_training_samples`, per API contract)
  - [x] Use logistic regression (not decision tree — more interpretable for the tiny dataset)
      <!-- NOTE: `LogisticRegression(max_iter=1000, random_state=42)`. No train/test split and no CV — 9 completed rows in the demo; CV would be theater. Training accuracy is reported and flagged as such in the UI. `InsufficientTrainingData` raised below MINIMUM_TRAINING_SAMPLES=5. Single-class target → accuracy=1.0, feature_importances={}, no fit. 8 pytests. -->
- [x] ML service: implement `/train` endpoint, write both results to `model_runs`
      <!-- NOTE: fetches completed+in-progress rows, reconstructs DataFrame shape (re-coerces dates), calls both training fns, catches InsufficientTrainingData → 400 with `n_completed_projects` + `minimum_required`. Snapshot + delete-then-insert with rollback (same pattern as /ingest). Reads back generated UUIDs and returns per TrainResponse contract. 6 pytests. -->
- [x] Frontend: add "Train Models" button on dashboard
      <!-- NOTE: `TrainModelsButton` (client) — POSTs to `/api/ml/train`, FastAPI-detail-aware error extraction, `router.refresh()` on success, `AbortController` cancels on unmount, double-click guarded. Disabled by parent when `completedCount < 5` (pre-empts server's 400 round-trip). -->
- [x] Frontend: build `ModelComparison` component side-by-side layout:
  - [x] Left column: "Naive model" with leaky features highlighted in red
  - [x] Right column: "Pre-construction model" with only bid-time features
  - [x] Accuracy shown prominently in each
  - [x] Feature importance bars (horizontal, Recharts)
  - [x] Explanatory copy: "The left model would be 100% accurate on training data, but couldn't be used before a project starts because it uses features like delay_days that only exist after the fact. The right model uses only information you'd have at bid time."
      <!-- NOTE: copy was rewritten tighter than the spec — see the "Why two models?" block in `model-comparison.tsx`. Leaky features detected by `LEAKY_FEATURE_STEMS.has(name)` (the leaky four are all numeric, not OHE'd). -->
- [x] Ensure features_used text and the UI match — no divergence
      <!-- NOTE: `formatFeatureName()` in `model-comparison.tsx` converts encoded `project_type_Commercial` → "Type: Commercial", `region_Northeast` → "Region: Northeast", etc. The raw strings in the DB are untouched — the display helper is the only place formatting happens. -->

**Acceptance:** Clicking "Train Models" produces the two-model comparison. The leakage narrative is clear to someone who doesn't know ML. The UI physically shows why the right model is the useful one. ✅ Verified prod at https://enlaye-five.vercel.app/.

**This is the single most important feature in the app.** If it works and is clear, you've made your case.

---

## Phase 5: RAG Pipeline

Goal: users can upload project documents and ask natural-language questions about them.

### 5a — Document Upload & Embedding

- [x] Supabase: write a SQL migration that (a) creates the `documents-bucket` Storage bucket via `INSERT INTO storage.buckets`, (b) enables `pg_net`, (c) creates an `AFTER INSERT` trigger on `documents` that POSTs to the `embed` Edge Function URL using `net.http_post`. Apply with `supabase db push`. **No Dashboard clicks.**
      <!-- NOTE: `20260420000000_documents_rag_pipeline.sql` — bucket 25 MB, MIME allowlist pdf/docx/txt/octet-stream, anon INSERT/SELECT/DELETE policies scoped to `portfolios/*` (same demo-mode caveat as CSV bucket), `pg_net` extension, `public.trigger_embed_document()` SECURITY DEFINER + pinned `search_path`, AFTER INSERT trigger `documents_embed_trigger`. `alter database postgres set app.settings.supabase_url/service_role_key` statements are left COMMENTED OUT (service_role key must not live in git) — **manual follow-up**: run those two `alter database` statements once against the cloud DB before the webhook can fire with a valid Bearer. Currently moot because `embed` is deployed with `--no-verify-jwt` (internal webhook only), so the empty Bearer is still accepted. -->
- [x] Edge Function `embed`: implement per ARCHITECTURE.md § Service Boundaries
  - [x] Download file from Storage
  - [x] Extract text (PDF via a Deno-compatible lib, DOCX via unzip+parse, TXT raw)
      <!-- NOTE: `npm:unpdf` (handles both old array + new merged-string shapes), `npm:mammoth` for DOCX raw text, `TextDecoder('utf-8')` for TXT. Unknown extension → `embedding_status = 'failed:<reason>'` and 200 so pg_net doesn't retry forever. -->
  - [x] Chunk text at ~400 tokens with 50 overlap
      <!-- NOTE: whitespace word splitter at 400 words / 50-word overlap (~500 BPE tokens, under gte-small's 512 context). Chunks <20 chars are dropped pre-embed. WHY no tokenizer: avoided bundling a WASM tokenizer into the Edge Function; the word-count approximation is documented inline. -->
  - [x] Generate embedding per chunk via `Supabase.ai.Session('gte-small')`
  - [x] Insert into `document_chunks`
  - [x] Update `documents.embedding_status` to `complete` on success, `failed` on error
      <!-- NOTE: failure reasons stuffed into the same `text` column as `failed:<reason>` (truncated to 500 chars). DocumentList treats any `failed*` prefix as failed. If stricter audit is needed later, split into `status` + `error_reason` columns. -->
- [x] Frontend: add a `DocumentUpload` component on portfolio page
- [x] Frontend: show upload status per document (pending → complete)

### 5b — Query Edge Function

- [x] Set Edge Function secrets via CLI: `supabase secrets set OPENROUTER_API_KEY=sk-or-v1-... OPENROUTER_MODEL=deepseek/deepseek-v3.2`
- [x] Edge Function `query`: implement per ARCHITECTURE.md § Service Boundaries
  - [x] Embed query
  - [x] pgvector similarity search
      <!-- NOTE: added `20260420000100_match_document_chunks_rpc.sql` — `match_document_chunks(p_portfolio_id, query_embedding vector(384), match_threshold, match_count)` returns (id, document_id, chunk_text, similarity) as `1 - (embedding <=> query)`; stable language sql so planner reuses the ivfflat cosine index. Execute granted to anon/authenticated/service_role. -->
  - [x] Threshold filter
  - [x] Prompt construction with explicit citation instruction
  - [x] OpenRouter call to `deepseek/deepseek-v3.2` (model id read from `OPENROUTER_MODEL` env var)
      <!-- NOTE: temperature 0.2, 25s AbortController timeout → 502 on timeout; OpenRouter non-2xx → 502 with upstream status; `HTTP-Referer: https://enlaye.com` + `X-Title: Enlaye` for OpenRouter attribution. -->
  - [x] Confidence calculation (high ≥ 0.7, medium ≥ 0.5, low below)
  - [x] Return `{ answer, sources, confidence }`
- [x] Handle no-results case gracefully (low confidence, empty sources)

### 5c — Chat UI

- [x] Frontend: build `ChatInterface` component
  - [x] Input box + submit button
  - [x] Message list showing Q and A
  - [x] Answer block with citation chips (e.g., [C1], [C3]) that expand to show source chunks
      <!-- NOTE: `/\[C(\d+)\]/g` splits the answer into text fragments + clickable chip buttons; each chip scrolls to / flashes a ring on the matching source card. Source card DOM ids are namespaced by message id to prevent cross-turn collisions. -->
  - [x] Confidence indicator (green/yellow/gray dot)
  - [x] Loading state during generation
- [x] Add `top_k` and `threshold` sliders as a "retrieval settings" expandable panel — this is how you turn the assessment's written-answer questions into an interactive demo
      <!-- NOTE: native `<input type="range">` (no shadcn slider installed — avoids adding a dep just for this). Cmd/Ctrl+Enter submits; plain Enter inserts a newline. -->
- [x] Add a few pre-written example questions as click-to-try suggestions

**Acceptance:** Upload a PDF, wait for it to process, ask a question about it, get a cited answer with visible source chunks. Sliders let you experiment with k and threshold. ✅ Deployed — migrations pushed to `papbpbuayuorqzbvwrnb`, `embed` deployed with `--no-verify-jwt`, `query` deployed with JWT verification, `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` set via `supabase secrets set`.

---

## Phase 6: Polish, Deploy, Submit

Goal: the app feels complete and deployed; the submission package is ready.

- [x] Empty states for every screen (no portfolios, no documents, no model runs yet)
      <!-- NOTE: shared `EmptyState` primitive in dashboard-shell.tsx now used by anomaly-list, projects-table, portfolio-summary, model-comparison, and home page first-run state. Added optional `hint` prop for next-step copy. -->
- [x] Loading states for every async operation
      <!-- NOTE: app/portfolios/[id]/loading.tsx skeleton (Suspense), CsvUpload spinner stages, TrainModelsButton, ChatInterface (typing indicator + aria-live log), DocumentUpload processing stage. -->
- [x] Error states for every failure mode (upload failed, training failed, query failed)
      <!-- NOTE: CsvUpload `describeRejection`/`describeError` (no more "[object Object]"), per-file retry on document upload, FastAPI-detail extraction in TrainModelsButton, query failures rendered into chat thread. -->
- [x] Accessibility pass: keyboard navigation, focus rings, ARIA labels where needed
      <!-- NOTE: every interactive element has focus-visible:ring; charts wrapped in role="img" + dynamic aria-label; anomaly pills carry descriptive aria-label; ChatInterface uses semantic <form>+<label> with aria-live="polite" on the message log; confidence indicator no longer color-only (text label too); citation chips are keyboard-activatable with aria-controls. -->
- [x] Performance pass: lazy-load heavy components, verify no blocking renders
      <!-- NOTE: ChatInterface lazy-loaded via chat-interface-lazy.tsx (next/dynamic, ssr:false) since it lives below the fold; CsvUpload lazy-loaded on the home page; PortfolioSummary aggregations memoized; MessageItem memoized to avoid re-render on every keystroke. -->
- [x] Pre-load the 15-row demo dataset so a reviewer sees data immediately on first visit
      <!-- NOTE: `frontend/public/demo/projects.csv` shipped; "Load demo data" button in csv-upload.tsx fetches it and POSTs to /api/ml/ingest. -->
- [x] Pre-load 2-3 demo PDFs for the RAG feature (synthesize from the assessment's chunk data)
      <!-- NOTE: 3 .txt files in `frontend/public/demo-docs/` (project-alpha-status-report, safety-incident-summary, change-order-log). TXT chosen over PDF — embed function supports it natively without extra tooling. Cross-references the 15-row CSV's project names. -->
- [x] README.md for the repo:
  - [x] Screenshot or GIF at top (placeholder marker — `<!-- TODO: add screenshot.png -->`)
  - [x] "Why I built this" paragraph
  - [x] Tech stack summary (link to ARCHITECTURE.md)
  - [x] Local setup instructions (one command ideally)
  - [x] Note on known limitations (single-user demo, RLS not implemented, etc.)
- [x] Final deploy, verify prod URLs work end-to-end
- [x] Write the submission email (see CLAUDE.md § When to stop adding features)
      <!-- NOTE: draft at `.tmp/submission-email.md` (gitignored). -->


**Acceptance:** A reviewer who has never seen the repo can load the prod URL, click around for 2 minutes, and understand both the product and the technical thinking behind it. ✅ Phase 6 complete; redeployed via `vercel --prod`.

---

## Cutting Guide (if time runs short)

Cuts, in order of preference:

1. **Cut Phase 5c's slider controls** — nice to have but not essential.
2. **Cut Phase 5 entirely if needed** — the ML comparison is enough to justify the submission. Note in the README that RAG is implemented in the original `.py` file deliverable.
3. **Cut Phase 3's chart polish** — basic HTML tables can substitute.
4. **Cut Phase 6 demo data preload** — instruct the reviewer to upload the assessment CSV themselves.
5. **Cut Phase 4** — this would be a mistake. If you're tempted to cut Phase 4, instead cut Phase 5.

**Never cut:** Phase 0, 1, 2, 4, or the `.py` file that the assessment explicitly asked for.

---

## Scope Boundaries (things NOT in the build)

These came up as possibilities and were rejected for this project scope. Document reasoning so future-you doesn't re-open them.

- **Multi-user with real auth** — complexity cost exceeds intern-project value; single-user demo mode with a note in README is fine.
- **Real-time subscriptions** — no multi-user collab means no need for Supabase Realtime.
- **CI/CD beyond auto-deploy on push** — GitHub Actions would be over-engineering.
- **Custom embedding model** — gte-small is sufficient for demo.
- **Hyperparameter tuning** — 9 training rows. Cross-validation would overfit worse than a naive train. Don't.
- **Storybook / component library docs** — no team to share with.
- **End-to-end tests** — unit tests for ML cleaning functions only. Playwright would consume a day we don't have.

---

## Open Questions / Future Work

Log things that came up but weren't decided. Don't resolve them silently.

- Should the confidence threshold be user-configurable in the final demo UI or hardcoded?
  → **Decision pending:** lean toward user-configurable because the assessment explicitly asks about it. See Phase 5c.

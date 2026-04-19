# WORKSTREAMS.md

> Parallel execution plan and live session log. This file tells you what work can be done in parallel, what sync points must be respected, and what's been done so far.

**Related docs:** [CLAUDE.md](./CLAUDE.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [IMPLEMENTATION.md](./IMPLEMENTATION.md) · [CONVENTIONS.md](./CONVENTIONS.md)

---

## Contents

1. [How Parallelism Works Here](#how-parallelism-works-here)
2. [The Three Tracks](#the-three-tracks)
3. [Sync Points](#sync-points)
4. [Running Parallel Claude Code Sessions](#running-parallel-claude-code-sessions)
5. [Live Status Board](#live-status-board)
6. [Session Log](#session-log)

---

## How Parallelism Works Here

Vibe coding benefits massively from parallelism — but only if boundaries are real. Two AI sessions editing the same file will produce merge chaos. Two sessions editing different directories with a locked-in API contract between them will ship twice as fast.

**The rule:** parallelism works across service boundaries, not inside them. You can have one session building the frontend while another builds the Python service — as long as they both agree on the API contract in ARCHITECTURE.md and don't touch each other's directories.

**The cost:** every parallel session you run increases the coordination cost (you, the human, must mentally sync them). Two is manageable. Three gets flaky. Never four.

---

## The Three Tracks

The work naturally divides into three independent tracks. After Phase 1 (foundation), these can run in parallel.

### Track A: Frontend (`frontend/`)

**Owns:** Next.js app, UI components, Supabase client integration, TanStack Query hooks, chart rendering, chat UI, styling.

**Does not touch:** `ml-service/`, `supabase/functions/`, database migrations.

**Depends on:** Database schema (Phase 1) and API contracts (stable in ARCHITECTURE.md). Can mock API responses until Python service is ready.

**Suggested Claude Code prompt when starting a session on this track:**
> "You are working on Track A (Frontend) of the Enlaye dashboard. Read CLAUDE.md, then the Track A section of WORKSTREAMS.md. Your scope is `frontend/` only. Do not modify `ml-service/`, `supabase/`, or any docs outside of checking off tasks. Start with the next unchecked task in IMPLEMENTATION.md that falls within frontend scope."

### Track B: Python ML Service (`ml-service/`)

**Owns:** FastAPI app, CSV parsing, cleaning logic, anomaly flagging, model training, Pydantic schemas, pytest suite.

**Does not touch:** `frontend/`, `supabase/functions/`, frontend styles.

**Depends on:** Database schema (Phase 1) and shared API contracts. Can be tested standalone with curl or pytest without frontend.

**Suggested Claude Code prompt when starting a session on this track:**
> "You are working on Track B (Python ML Service) of the Enlaye dashboard. Read CLAUDE.md, then the Track B section of WORKSTREAMS.md. Your scope is `ml-service/` only. Start with the next unchecked task in IMPLEMENTATION.md within ML scope. When you implement an endpoint, verify the Pydantic schema matches ARCHITECTURE.md § API Contracts exactly."

### Track C: Supabase (`supabase/`)

**Owns:** Database migrations, RLS policies (when added), Edge Functions (embed, query), Supabase secrets setup.

**Does not touch:** `frontend/`, `ml-service/`.

**Depends on:** Data contracts (what embeddings look like, what the query function returns). Can be developed locally via `supabase start` without prod.

**Suggested Claude Code prompt when starting a session on this track:**
> "You are working on Track C (Supabase) of the Enlaye dashboard. Read CLAUDE.md, then the Track C section of WORKSTREAMS.md. Your scope is `supabase/` only. Test Edge Functions locally with `supabase functions serve` before deploying."

---

## Sync Points

Moments where tracks MUST rendezvous. Attempting to work past a sync point before it's resolved causes bugs.

| Sync point | What triggers it | Who needs to coordinate |
|---|---|---|
| **Schema finalized** | First migration written | A, B, and C all read from the same schema |
| **API contract changed** | Any change to `/ingest`, `/train`, or `query` function signature | Whoever changed it must update ARCHITECTURE.md AND alert the other tracks |
| **Embedding dimension** | Changing from gte-small to anything else | C must update migration, A must update queries, B must update expected vectors |
| **New env var** | Any track adds an env var | All three `.env*` templates must update |
| **Deploy pipeline changes** | Adding a build step or changing a Dockerfile | Vercel and Railway configs may need matching |

**Protocol when hitting a sync point:** stop the current track, update ARCHITECTURE.md, leave a note in the session log below, and let the human decide whether to resume other tracks or pause.

---

## Running Parallel Claude Code Sessions

If the human wants to run two Claude Code sessions at once, here's the ritual.

**Setup:**
1. Open two terminal windows/tabs, both in the repo root.
2. Each session starts by reading CLAUDE.md + its assigned track section here.
3. Each session creates a feature branch: `git checkout -b track-a-phase-3` (or similar).
4. Each session commits frequently (every completed task).

**Coordination:**
- Human rebases / merges feature branches back to `main` at the end of each session.
- No session should ever force-push to main.
- If both sessions need to update IMPLEMENTATION.md (checking off tasks), they'll conflict — resolve manually.
- Session log below must be updated by each session before handing back.

**When parallelism is NOT worth it:**
- Phase 0 (bootstrap) — structural, do it once.
- Phase 1 (foundation) — schema and wiring, needs coordinated changes.
- Phase 6 (polish) — cross-cutting, parallel edits cause conflicts.

**Best parallel windows:** Phases 2 (frontend upload UI + backend cleaning can go at once) and 5 (RAG chat UI + embed/query functions can go at once).

---

## Live Status Board

Keep this accurate. Replace the `⬜` emojis when state changes.

### Track A: Frontend
- Phase 0: ✅ Complete (scaffold)
- Phase 1: ⬜ Not started
- Phase 2: ⬜ Not started
- Phase 3: ⬜ Not started
- Phase 4: ⬜ Not started
- Phase 5: ⬜ Not started
- Phase 6: ⬜ Not started

### Track B: Python ML Service
- Phase 0: ✅ Complete (scaffold + stubs)
- Phase 1: ⬜ Not started
- Phase 2: ⬜ Not started
- Phase 4 ML logic: ⬜ Not started

### Track C: Supabase
- Phase 0: ✅ Complete (init + function stubs)
- Phase 1 (schema): ⬜ Not started
- Phase 5a (embed function): ⬜ Stub only
- Phase 5b (query function): ⬜ Stub only

**Legend:** ⬜ Not started · 🟡 In progress · ✅ Complete · ⚠️ Blocked

### Current Blockers
*(none yet — add as they come up)*

### Parking Lot (deferred decisions)
*(none yet — see IMPLEMENTATION.md § Open Questions)*

---

## Session Log

Every Claude Code session appends an entry here before handing control back. Keep entries tight — dates, tracks, what changed, what's next, any gotchas the next session needs to know.

**Format:**
```
### YYYY-MM-DD — Session N — [Track(s)]
- **Did:** what you completed (link to checked-off tasks)
- **Changed:** any files outside your task scope (docs, configs)
- **Next:** what the next session should pick up
- **Notes:** anything weird, any decisions deferred, any discoveries
```

---

### YYYY-MM-DD — Session 0 — Setup
- **Did:** Created CLAUDE.md, ARCHITECTURE.md, IMPLEMENTATION.md, WORKSTREAMS.md, CONVENTIONS.md from the design phase.
- **Changed:** N/A — project scaffold does not yet exist.
- **Next:** Human runs "get started" to trigger Phase 0 bootstrap per CLAUDE.md.
- **Notes:** All docs are living. Update them as the project evolves. Do not let them drift.

### 2026-04-18 — Session 1 — Phase 0 bootstrap (all tracks)
- **Did:**
  - Verified toolchain (Node 25.8, Python 3.13, supabase 2.75, gh 2.90, vercel 51.7, railway 4.40).
  - Scaffolded `frontend/` with `create-next-app` (TS + Tailwind + App Router, `--no-src-dir`, `@/*` alias, eslint).
  - Installed frontend runtime deps: `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-query`, `recharts`, `react-dropzone`, `papaparse`, `zod` (+ `@types/papaparse` dev).
  - Initialized `shadcn/ui` with defaults (button, utils).
  - Scaffolded `ml-service/` — FastAPI entry `main.py` with `/health`, stubbed `/ingest` and `/train` guarded by bearer-token dependency; `requirements.txt`, `pyproject.toml`, `Dockerfile`, `.dockerignore`, `README.md`.
  - Created Edge Function stubs `supabase/functions/embed/index.ts` and `supabase/functions/query/index.ts` (both return 501; `query` validates request shape).
  - Generated 32-byte `INTERNAL_API_TOKEN`; wrote it into root `.env`, `frontend/.env.local`, `ml-service/.env` (all gitignored; verified via `git check-ignore`).
  - Typechecked frontend (`npx tsc --noEmit` clean) and built it (`npm run build` ✓ — Next 16.2.4 via Turbopack).
- **Changed:** `WORKSTREAMS.md` (this log + status board); `.env` (INTERNAL_API_TOKEN now populated).
- **Next:** Phase 1 — write the initial database schema migration per `ARCHITECTURE.md § Database Schema`, then wire Supabase client helpers in the frontend.
- **Notes:**
  - Next.js 16 default dev/build uses Turbopack (not webpack as CLAUDE.md implied). Warning about duplicate lockfile at `C:\Users\John Doe\Music\package-lock.json` (outside repo) — non-blocking.
  - `supabase` CLI flags an update (2.75 → 2.90 available). Not blocking.
  - shadcn init wrote `components/ui/button.tsx` and `lib/utils.ts`; `components.json` present.
  - Did NOT yet: initialize `.venv` for ml-service, run `pytest`, deploy anything, touch cloud state.

### 2026-04-18 — Session 2 — Phase 1 foundation (all tracks)
- **Did:**
  - Wrote initial migration `supabase/migrations/20260419014526_initial_schema.sql` covering all 5 tables + pgvector(384) + IVFFlat index per ARCHITECTURE.md § Database Schema. NOT NULL constraints on all `portfolio_id` / `document_id` FKs.
  - Applied locally (`supabase db reset`) and remotely (`supabase db push` to `papbpbuayuorqzbvwrnb`).
  - ML service: added module-level Supabase client using `SUPABASE_SERVICE_ROLE_KEY`; `/health` probes `portfolios` via cheap `select('id').limit(1)` and returns 503 (not 200) when DB unreachable. Disabled FastAPI `/docs`, `/redoc`, `/openapi.json`.
  - Frontend: `lib/types.ts` (shared row types), `lib/supabase.ts` (browser + cookies-aware async server factories via `@supabase/ssr`), `app/api/ml/[...path]/route.ts` (hard-allowlisted proxy — GET health, POST ingest, POST train only — stamps `Authorization: Bearer ${INTERNAL_API_TOKEN}`, pins `content-type: application/json` for non-GETs), new `app/page.tsx` that reads `portfolios` server-side and fetches `/api/ml/health` through the proxy using origin derived from `headers()` (works on Vercel).
  - Adversarial review by Codex caught 2 HIGH + 3 MEDIUM + 1 LOW findings; all fixed. Smoke test also caught that `supabase-py` 2.9 doesn't accept `head=True` on `.select()` (JS SDK only) — replaced with `.limit(1)`.
  - Vercel: project `enlaye` created under `zh-3135s-projects`, linked `frontend/`, set production env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `INTERNAL_API_TOKEN`, `ML_SERVICE_URL=https://ml-service-production-513e.up.railway.app`.
  - Railway: project `enlaye-ml-service` / service `ml-service`; set prod env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_API_TOKEN`; public domain generated; initial deploy via `railway up --detach`.
- **Changed:** `IMPLEMENTATION.md` (Phase 0 + Phase 1 checkboxes), `frontend/.gitignore` (+ `.vercel/`), `WORKSTREAMS.md` (this entry).
- **Next:** Commit + push to `main` to trigger Vercel auto-deploy; curl-check prod `/` and `/api/ml/health` end-to-end; then start Phase 2 (CSV ingest).
- **Notes:**
  - Railway service was created empty (not from GitHub repo), so `git push` alone won't auto-deploy ML service — we use `railway up` from the CLI. Can wire GH integration later if desired.
  - `--scope zh-3135` on `vercel link` is rejected (it's a personal account, not an org); omitted and it works.
  - Supabase Python SDK call shape differs from JS — watch for that in Phase 2.
  - IVFFlat index logs a "little data" NOTICE at migration time; expected for an empty table.

### 2026-04-18 — Session 3 — Phase 2 CSV ingest (subagent-driven, parallel tracks B+C)
- **Did:**
  - Ran Phase 2 via subagent-driven development: implementer → spec reviewer → quality reviewer → controller commit, one cycle per task. Task A (cleaning + bucket migration) ran sequentially; Tasks B (`/ingest` endpoint) and C (frontend upload + dashboard) ran in parallel on the same `main` branch since they touch disjoint file trees (`ml-service/*` vs `frontend/**`).
  - **Task A** — `ml-service/cleaning.py` (pure functions: parse → coerce → median-impute completed-only → flag anomalies), migration `20260418222808_portfolios_uploads_bucket.sql` creating private bucket with 10 MB cap, 9 pytests.
  - **Task B** — `/ingest` in `ml-service/main.py` with delete-then-insert idempotency, `_canonical_storage_path` (blocks traversal + cross-portfolio), `_df_to_records` (NaT/NaN→None, ISO dates, nullable-Int64 safe). 12 pytests. Broadened exception mapping catches `pd.errors.ParserError` / `EmptyDataError` / `UnicodeDecodeError` → 400.
  - **Task C** — `app/page.tsx` rewritten as upload surface with react-dropzone + "Load demo data" button, `app/portfolios/[id]/page.tsx` dashboard (server component), components `csv-upload`, `projects-table`, `cleaning-report-panel`, `anomaly-pill`. Split `lib/supabase.ts` into server module + new `lib/supabase-browser.ts` so client components don't pull in `next/headers`.
  - **Codex adversarial review** caught 1 CRITICAL + 3 HIGH + 1 MEDIUM post-review: storage bucket had zero RLS policies (anon upload would fail in prod — tests masked it with service_role); `/ingest` trusted any `storage_path` for any `portfolio_id`; delete/insert/update wasn't atomic; pandas non-ValueError exceptions became 500s. Fixed with migration `20260419030649_storage_policies_anon_demo.sql` (anon INSERT/SELECT/DELETE scoped to `portfolios/*` within the bucket), canonical-path enforcement, snapshot-based metadata rollback, and broadened exception handling. Anon-scope verified via live test: insert portfolio ✓, upload within prefix ✓, upload outside prefix blocked ✓.
  - **Cloud deploy**: pushed 2 migrations to `papbpbuayuorqzbvwrnb`, re-deployed Railway ml-service via `railway up`, redeployed Vercel via `vercel --prod`. End-to-end smoke passed: frontend 200, `/api/ml/health` → 200 `{db_reachable:true}`, proxy allowlist still blocks `/docs` + `/openapi.json`.
- **Changed:** `ARCHITECTURE.md` (changelog entry below), `IMPLEMENTATION.md` (Phase 2 checkboxes + gotcha notes), this file.
- **Next:** Phase 3 (summary dashboard — Recharts bars, portfolio summary component, style pass) or Phase 4 (two-model comparison). The two-model comparison is the higher-leverage showcase; Phase 3 can be bundled with polish in Phase 6.
- **Notes:**
  - `supabase-py` 2.9 differences from JS SDK keep catching us: `head=True` not accepted on `.select()` (Phase 1), and no transaction wrapper for multi-statement mutations (Phase 2 — worked around with snapshot rollback). A Postgres RPC function that wraps delete+insert+update in one transaction is the correct long-term fix; deferred until multi-user.
  - Subagent-driven development + Codex review gave genuinely different lenses: internal reviewers caught style + missing tests; Codex caught the RLS gap and the cross-ingest vulnerability that internal reviewers had already implicitly green-lit.
  - Railway was not GH-linked (per Phase 1), so deploys still require `railway up` from CLI. Vercel could be GH-linked later for auto-deploy on push.

### 2026-04-18 — Session 4 — Phase 3 summary dashboard (parallel implementers)
- **Did:**
  - Ran Phase 3 via three parallel implementer agents on disjoint file trees (no reviewer loops this phase — specs were tight, typecheck + build + Codex:rescue gated merge instead): `portfolio-summary.tsx`, `anomaly-list.tsx`, `dashboard-shell.tsx`. Integration happened in the controller at `app/portfolios/[id]/page.tsx`.
  - **PortfolioSummary** (client, `components/portfolio-summary.tsx`): 4 stat tiles (total contract value compact-USD, completed, in-progress, avg delay) + 2 Recharts bar charts (mean delay / mean cost overrun by project type) + Recharts donut (projects by region). All aggregations in `useMemo` with null/NaN guards; per-chart "Not enough data to chart." fallback when its bucket is empty; single-card empty-state when `projects.length === 0`.
  - **AnomalyList** (server, `components/anomaly-list.tsx`): flagged projects as cards with per-rule descriptions that embed the actual row value and the threshold ("32.1% overrun (threshold 25%)"). Palette mirrors `anomaly-pill.tsx` (amber/orange/red/purple); FLAG_MAP duplicated locally to avoid editing `anomaly-pill.tsx` while parallel agents were in flight. Sort descending by flag count, stable on original order. Empty state when no flags.
  - **DashboardShell** (server, `components/dashboard-shell.tsx`): sticky top header (Enlaye · portfolio name · row/anomaly counts, counts hidden below `sm`) + CSS-only responsive sidebar (vertical on md+, horizontal scrollable pills on mobile). Nav items: Overview, Projects, Anomalies (active hash links), Documents, Models (disabled, tooltip-hinting Phase 5 / Phase 4). Also exports `EmptyState` primitive for future placeholders. Uses `lucide-react` icons.
  - **Page integration**: `app/portfolios/[id]/page.tsx` now wraps content in `DashboardShell`, adds `#overview` / `#projects` / `#anomalies` section anchors with `scroll-mt-20` for the sticky-header offset. Order: title/meta → cleaning report → overview → projects table → anomalies.
  - **Verified**: `npx tsc --noEmit` clean; `npm run build` clean (all routes SSR or ISR as before); `vercel --prod` deployed; https://enlaye-five.vercel.app/ → 200.
  - **Codex:rescue** review (codex exec --effort high): returned "No blocking issues found." (no CRITICAL, no HIGH). Three MEDIUMs all applied: (1) threshold copy drift — UI said "threshold 25%" / "threshold 150" but ML rules use strict `>`; now reads "> 25%" and "> 150 days". (2) Donut palette exhausted at 7+ regions — expanded from 6 to 10 colors. (3) Long `project_type` x-axis labels could overlap — added `interval={0}`, `angle={-20}`, `textAnchor="end"`, `height={56}` to both bar charts. One LOW (disabled-nav tabindex skipped — reviewed, accepted for demo), one NIT (duplicated FLAG_MAP — accepted, flagged in comment for Phase 4 reconciliation).
- **Changed:** `IMPLEMENTATION.md` (Phase 3 checkboxes), `ARCHITECTURE.md` (changelog), this file.
- **Next:** Phase 4 (two-model comparison — the showcase). Phase 5 (RAG) has higher novelty cost but the two-model comparison is what the assessment is asking about.
- **Notes:**
  - Skipped the two-reviewer-per-task loop for Phase 3. Justification: three small, self-contained UI components with tight specs; Codex:rescue + build acts as the review gate. For Phase 4 (multi-file change with ML logic crossing service boundaries) we're back to the full reviewer cycle.
  - Mobile sidebar is CSS-only dual-DOM (both variants rendered, one hidden). Acceptable for 5 nav items; if the list grows we should switch to a client-side disclosure.
  - Hash anchors use plain `<a>`, not `<Link>` — `next/link` is for route transitions, not same-page jumps. Documented in `dashboard-shell.tsx`.

### 2026-04-18 — Session 5 — Phase 4 two-model comparison (4-way parallel dispatch)
- **Did:**
  - Ran Phase 4 via **four** parallel implementer agents on fully disjoint file trees: (1) `ml-service/models.py` + tests, (2) `/train` endpoint wiring in `ml-service/main.py` + tests, (3) `frontend/components/model-comparison.tsx`, (4) `frontend/components/train-models-button.tsx`. Controller pinned the public API of `models.py` upfront so agent (2) could trust the contract without serializing on (1).
  - **models.py**: `train_naive_model` + `train_pre_construction_model` on top of a private `_train` helper. Target `y = (payment_disputes >= 1).astype(int)` on completed rows only. Encoding via `pd.get_dummies(drop_first=False, dtype=float)`. Model: `LogisticRegression(max_iter=1000, random_state=42)`. No CV / no train-test split — reported training accuracy (9 completed rows in demo; CV would be theater). Single-class target returns `accuracy=1.0, feature_importances={}`. `InsufficientTrainingData` raised below `MINIMUM_TRAINING_SAMPLES=5`. 8 pytests.
  - **/train**: fetches projects, reconstructs DataFrame with date re-coercion, calls both trainers, catches `InsufficientTrainingData → 400 { error, n_completed_projects, minimum_required }`. Idempotent snapshot + delete-then-insert into `model_runs` with rollback on failure (same pattern as `/ingest`). Reads back Postgres-generated UUIDs, returns `TrainResponse`. 6 pytests.
  - **ModelComparison**: client component, two cards side-by-side (red accent naive / emerald pre_construction), accuracy at `text-4xl`, horizontal Recharts bars with per-Cell fill (red for leaky features in naive, blue otherwise; emerald across the board for pre_construction). `formatFeatureName` normalises encoded names to human strings. Explanatory "Why two models?" footer. Empty-state when `runs` missing either model_type; picks most recent by `created_at` if duplicates exist.
  - **TrainModelsButton**: client component, `AbortController`-gated fetch, FastAPI-detail-aware error extraction mapped to user-friendly messages, `router.refresh()` on success, re-entrancy guarded.
  - **Integration**: `app/portfolios/[id]/page.tsx` adds a parallel `model_runs` fetch, `#models` section with button + comparison, `canTrain` gate at `completedCount >= 5` (local constant comment-linked to `models.py`). Enabled the `Models` nav item in `dashboard-shell.tsx` (was disabled-with-tooltip during Phase 3).
  - **Verified**: frontend typecheck clean, `npm run build` clean, full ML suite `35/35 passed` (9 cleaning + 12 ingest + 8 models + 6 train). Deployed Railway (`railway up --detach`) + Vercel (`vercel --prod`). `https://ml-service-production-513e.up.railway.app/health` → 200, `https://enlaye-five.vercel.app/` → 200.
  - **Codex:rescue** review (codex exec --effort high): returned "No blocking issues found." (no CRITICAL/HIGH). Two MEDIUMs and three LOWs triaged:
    - MEDIUM — `/train` concurrency race (two simultaneous POSTs can leave 4 rows / return the wrong UUID). Accepted as-is for single-user demo; hardening plan documented (add `UNIQUE(portfolio_id, model_type)` constraint + Postgres RPC for transactional delete+insert when we go multi-user).
    - MEDIUM — `/train` 400 body contract drift: `ARCHITECTURE.md § /train` documented a top-level `{ error, n_completed_projects, minimum_required }`, but FastAPI's `HTTPException(detail={...})` wraps as `{"detail": {...}}` — same pattern `/ingest` already uses. **Docs now match the wire** (updated ARCHITECTURE.md to the actual `{detail: {...}}` shape and noted the convention).
    - LOW — `ModelComparison` rendered partial `model_runs` state as the generic "no runs yet" empty-state. **Fixed:** distinct copy when exactly one model_type is present ("Only the naive model has a recorded run; pre-construction is missing. Click Train Models to rebuild the comparison.").
    - LOW — `MINIMUM_TRAINING_SAMPLES` is duplicated between `ml-service/models.py` and `frontend/app/portfolios/[id]/page.tsx`. Already commented in the code; not fixing until a shared-constants module is worth it (Phase 6 or multi-user).
    - LOW — `extractTrainError` in `TrainModelsButton` only special-cased FastAPI's `{detail: ...}` shape; proxy-level errors (`/api/ml/[...path]` returns top-level `{error}` for bad bearer / ML unreachable) fell back to the generic "Training failed: 502". **Fixed:** helper now also handles the proxy's `{error, detail?}` shape.
  - Codex fixes landed in a single follow-up commit on top of the Phase 4 feature commit.
- **Changed:** `IMPLEMENTATION.md` (Phase 4 checkboxes + notes), `ARCHITECTURE.md` (changelog below), this file.
- **Next:** Phase 5 (RAG), or Phase 6 polish (README with screenshot/GIF, empty/error states across every surface, submit).
- **Notes:**
  - Four-way parallel worked cleanly — the ~5-minute wall-clock was gated by the slowest agent (the `/train` integration agent, which had to wait for `models.py` to land to run its test suite). Contract-first dispatch meant zero interface drift; the only touch-up was the integration page.
  - `MINIMUM_TRAINING_SAMPLES` is duplicated across `ml-service/models.py` and `frontend/app/portfolios/[id]/page.tsx` (local const with a comment pointing at the Python source). Shared-constant import via a generated types file would be cleaner — deferred.
  - Recharts `<Cell>` is marked deprecated in Recharts 3's `.d.ts` but still works. Noted; no action.

### 2026-04-18 — Session 6 — Phase 5 RAG pipeline (5-way parallel dispatch)
- **Did:**
  - Ran Phase 5 via **five** parallel agents on disjoint files. Contract-first: migration shape, `document_chunks` schema, and the `query` API contract were all frozen in ARCHITECTURE.md before dispatch so agents couldn't drift.
    1. **Migration agent** — `supabase/migrations/20260420000000_documents_rag_pipeline.sql`: `documents-bucket` Storage bucket (25 MB, pdf/docx/txt/octet-stream), anon INSERT/SELECT/DELETE RLS scoped to `portfolios/*`, `pg_net` extension, `public.trigger_embed_document()` SECURITY DEFINER + pinned `search_path`, AFTER INSERT trigger `documents_embed_trigger`. `alter database postgres set app.settings.*` left commented out — **manual follow-up** so the service_role key never lands in git.
    2. **Embed function agent** — `supabase/functions/embed/index.ts` using `npm:unpdf` / `npm:mammoth` / `TextDecoder`. Whitespace chunker at 400 words / 50-word overlap (~500 BPE tokens, under gte-small's 512 context); chunks <20 chars dropped. `Supabase.ai.Session('gte-small')` → 384-dim vectors, bulk insert into `document_chunks`, flip `documents.embedding_status` to `complete`. All runtime failures land as `embedding_status = 'failed:<reason>'` and return 200 so pg_net doesn't retry forever.
    3. **Query function agent** — `supabase/functions/query/index.ts` + new RPC migration `20260420000100_match_document_chunks_rpc.sql`. RPC returns `(id, document_id, chunk_text, similarity)` where `similarity = 1 - (embedding <=> query)`; `language sql stable` so the planner reuses the ivfflat cosine index. Function embeds question → RPC → numbered `[Cn]` excerpts → OpenRouter (`deepseek/deepseek-v3.2`, temp 0.2, 25s `AbortController` timeout). Confidence `high` if top sim ≥ 0.7 else `medium`; `low` when no chunks pass threshold.
    4. **Doc upload UI agent** — `frontend/components/document-upload.tsx` (client) and `frontend/components/document-list.tsx` (server). Path `portfolios/<id>/docs/<ts>-<safeFilename>`. Two-step flow: Storage upload first, then `documents` row insert (trigger fires), then `router.refresh()`. DocumentList renders pending/complete/failed pills with reason passthrough.
    5. **Chat UI agent** — `frontend/components/chat-interface.tsx` (client). POSTs directly to `${SUPABASE_URL}/functions/v1/query` with anon key. Per-session message list (no persistence). Citation chips from `/\[C(\d+)\]/g` split that scroll+ring the matching source card (DOM ids namespaced by message id). Native `<input type="range">` sliders for `top_k` / `threshold` — no new dep. `AbortController` cancels on unmount / new submit.
  - **Integration** (controller, not agents): `app/portfolios/[id]/page.tsx` fetches documents in parallel and mounts `DocumentUpload` + `DocumentList` in a new `#documents` section and `ChatInterfaceLazy` in a new `#ask` section. `dashboard-shell.tsx` enabled the Documents nav item (was disabled-with-tooltip) and added an Ask nav item. Migration comment corrected to match the actual upload path convention.
  - **Verified**: frontend typecheck clean, `npm run build` clean, both migrations applied to cloud via `supabase db push`, `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` set via `supabase secrets set`, `embed` deployed with `--no-verify-jwt` (internal webhook only), `query` deployed with JWT verification.
  - **Codex:rescue review skipped** this session (session interrupted). Sharp edges the agents already flagged:
    - Storage orphan on `documents` insert failure (FIXME in `document-upload.tsx`; same pattern as CSV orphan).
    - `embedding_status` overloaded with `failed:<reason>` prefix — split into `status` + `error_reason` if stricter schema wanted.
    - `app.settings.*` GUCs still not set; webhook posts with empty Bearer. Moot while `embed` is deployed `--no-verify-jwt`; required only if we re-enable JWT on embed.
    - `portfolio_id` trusted from query body — any anon-key holder can query any portfolio. Matches single-user demo posture; multi-tenant requires RLS + `auth.uid()` checks.
    - `ivfflat lists=100` over-partitions tiny corpora; if recall feels off, `SET LOCAL ivfflat.probes = 10`.
    - Full chunk_text passed to LLM (not preview) — `top_k` cap of 20 is the only context-window guard.
- **Changed:** `supabase/migrations/20260420000000_documents_rag_pipeline.sql` (NEW), `supabase/migrations/20260420000100_match_document_chunks_rpc.sql` (NEW), `supabase/functions/embed/index.ts` + `deno.json` (stub → real), `supabase/functions/query/index.ts` + `deno.json` (stub → real), `frontend/components/document-upload.tsx` (NEW), `frontend/components/document-list.tsx` (NEW), `frontend/components/chat-interface.tsx` (NEW), `frontend/components/chat-interface-lazy.tsx` (NEW), `frontend/components/dashboard-shell.tsx` (enabled Documents, added Ask), `frontend/app/portfolios/[id]/page.tsx` (documents fetch + #documents + #ask sections), `IMPLEMENTATION.md`, this file.
- **Next:** Phase 6 polish (README with screenshot, empty/error/loading states across every surface, submission email). Optional hardening: run the two `alter database postgres set app.settings.*` statements and redeploy `embed` with JWT verification for defense-in-depth.
- **Notes:**
  - Five-way parallel worked — wall-clock was gated by the chat-UI agent (most decisions). Zero merge conflicts because every agent's write set was disjoint; controller owned the only shared touch (`page.tsx`).
  - Codex:rescue was attempted but interrupted by the user; worth running on the Phase 5 changes before or during Phase 6.

### 2026-04-19 — Session 7 — Phase 6 polish (5-way parallel dispatch)
- **Did:**
  - Ran Phase 6 via **five** parallel agents on disjoint file groups; controller owned integration glue.
    1. **Dashboard-polish agent** — DashboardShell, PortfolioSummary, AnomalyList, AnomalyPill, ProjectsTable, ModelComparison, TrainModelsButton, CleaningReportPanel, portfolio page. Shared `EmptyState` extended with a `hint` slot; pills carry full `aria-label`; charts wrapped `role="img"` with dynamic descriptions; new `app/portfolios/[id]/loading.tsx` skeleton (Suspense).
    2. **CSV-upload-polish agent** — `csv-upload.tsx` rewrite (success+error stages with focus management, `prefers-reduced-motion`, real `<input type="file">` fallback, readable rejection messages); `app/page.tsx` first-run empty-state card; `CsvUpload` lazy-loaded via `next/dynamic` from the server component (Next 16 supports this).
    3. **RAG-polish agent** — `chat-interface.tsx` semantic `<form>` with Enter-submits / Shift+Enter newline (IME composition respected), `aria-live="polite"` log, citation chips with `aria-controls`, confidence text label (no longer color-only), `MessageItem` memoized. `document-list.tsx` switched to `<ul><li>` semantics. `document-upload.tsx` got a "Processing…" bridging stage.
    4. **README agent** — root `README.md`: title + screenshot placeholder, why-I-built, tech-stack table, how the showcase works, local setup (honest 3-terminal bootstrap), repo layout, known limitations.
    5. **Demo-content agent** — three `.txt` docs in `frontend/public/demo-docs/` (project-alpha-status-report, safety-incident-summary, change-order-log) sized for citable answers and cross-referenced with the 15-row demo CSV; submission email draft at `.tmp/submission-email.md` (gitignored).
  - **Integration** (controller, not agents): added `disabled` prop to ChatInterface and wired `disabled={!hasIndexedDocuments}` from page; created `chat-interface-lazy.tsx` (next/dynamic, ssr:false) and swapped the page import. Added `.tmp/` to `.gitignore`.
  - **Verified**: `npx tsc --noEmit` clean; `npm run build` clean (3 routes generated, Turbopack).
  - **Codex:rescue** was attempted but the user interrupted; skipped per request and went straight to deploy.
- **Changed:** `frontend/components/{dashboard-shell,portfolio-summary,anomaly-list,anomaly-pill,projects-table,model-comparison,train-models-button,cleaning-report-panel,csv-upload,chat-interface,document-list,document-upload}.tsx`, `frontend/components/chat-interface-lazy.tsx` (NEW), `frontend/app/{layout,page}.tsx`, `frontend/app/portfolios/[id]/{page,loading}.tsx`, `frontend/public/demo-docs/*.txt` (3 NEW), `README.md` (NEW), `.gitignore`, `IMPLEMENTATION.md`, this file.
- **Next:** None — Phase 6 closes the build. Optional follow-ups: real screenshot for README, codex:rescue audit pass, hardening items still listed in Session 6 notes.
- **Notes:**
  - Five-way parallel held up again — disjoint file ownership meant zero merge conflicts. The two integration flags the RAG agent surfaced (lazy-loading, `hasIndexedDocuments` gate) were both small and resolved by the controller without re-dispatching.

<!-- New sessions append above this line, below the Session 0 entry -->

---

## Tips for the Human Operator

Things the person steering the AI should keep in mind.

1. **Read the session log before every session.** 30 seconds of orientation saves 10 minutes of confused re-work.
2. **When you switch tracks, say so explicitly.** Don't let Claude Code guess. "Switching to Track B" clears context from Track A's last run.
3. **Commit often.** If Claude Code takes a wrong turn, `git reset --hard HEAD` is your friend — but only works if you've committed the known-good state.
4. **Don't skip sync point updates.** A lazy afternoon where you skip updating ARCHITECTURE.md after changing an API contract becomes a three-hour debug session tomorrow.
5. **Two sessions, not three.** We said it above, we'll say it again. The coordination cost is real.

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

<!-- New sessions append above this line, below the Session 0 entry -->

---

## Tips for the Human Operator

Things the person steering the AI should keep in mind.

1. **Read the session log before every session.** 30 seconds of orientation saves 10 minutes of confused re-work.
2. **When you switch tracks, say so explicitly.** Don't let Claude Code guess. "Switching to Track B" clears context from Track A's last run.
3. **Commit often.** If Claude Code takes a wrong turn, `git reset --hard HEAD` is your friend — but only works if you've committed the known-good state.
4. **Don't skip sync point updates.** A lazy afternoon where you skip updating ARCHITECTURE.md after changing an API contract becomes a three-hour debug session tomorrow.
5. **Two sessions, not three.** We said it above, we'll say it again. The coordination cost is real.

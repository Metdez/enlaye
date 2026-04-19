# CONVENTIONS.md

> Code patterns, security rules, comment protocol, anti-patterns. This is the "senior engineer standards" doc. Follow these. If a new pattern emerges during the build, add it here — don't let conventions live only in your head.

**Related docs:** [CLAUDE.md](./CLAUDE.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [IMPLEMENTATION.md](./IMPLEMENTATION.md) · [WORKSTREAMS.md](./WORKSTREAMS.md)

---

## Contents

1. [Security Rules (absolute)](#security-rules-absolute)
2. [Git Conventions](#git-conventions)
3. [Gitignore Template](#gitignore-template)
4. [Directory Structure](#directory-structure)
5. [TypeScript / Next.js Conventions](#typescript--nextjs-conventions)
6. [Python / FastAPI Conventions](#python--fastapi-conventions)
7. [Database Conventions](#database-conventions)
8. [Comments and Notes](#comments-and-notes)
9. [Error Handling](#error-handling)
10. [Testing Philosophy](#testing-philosophy)
11. [Anti-Patterns (things never to do)](#anti-patterns)
12. [Frontend Design Principles](#frontend-design-principles)

---

## Security Rules (absolute)

Zero exceptions. These override every other convention.

1. **No secrets in source.** Ever. If you're tempted, read this rule again.
2. **Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-visible.** Everything else is server-side.
3. **`SUPABASE_SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` live in:** Python service env vars on Railway, Supabase Edge Function secrets, and local `.env` files that are gitignored. Nowhere else.
4. **Before every commit:** `git status` and eyeball for any `.env*` file. If you see one, stop and fix the gitignore.
5. **Shared bearer token between frontend API routes and Python service** (`INTERNAL_API_TOKEN`). Frontend API routes add it to outbound requests; Python service rejects requests without it.
6. **No `console.log` of secrets.** Even temporarily. Remove debug logs before commit.
7. **OpenRouter spend cap is set to $5** in the OpenRouter dashboard. This is your last line of defense against a leaked key.

---

## Git Conventions

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
<type>(<scope>): <short summary>

<optional body explaining why>
```

Types:
- `feat` — new feature
- `fix` — bug fix
- `chore` — tooling, config, dependencies
- `docs` — documentation only
- `refactor` — no behavior change
- `test` — adding or updating tests
- `style` — formatting, no code change

Scopes: `frontend`, `ml`, `supabase`, `docs`, or omit.

Examples:
```
feat(ml): add median imputation for completed projects
fix(frontend): prevent double-submit on upload button
chore: update Supabase CLI to v1.x
docs(arch): add changelog entry for API contract change
```

### Branching

- `main` is deployable. Everything there should build.
- Feature branches: `feat/<scope>-<short-name>`, e.g. `feat/frontend-chat-ui`.
- Parallel sessions use branches per track: `track-a-phase-3`, etc.
- Squash-merge feature branches back to main.

### Commit Cadence

Commit at every completed task from IMPLEMENTATION.md. Yes, that's a lot of commits. Small commits are revertable; huge commits are not.

---

## Gitignore Template

Put this in `.gitignore` at the repo root **before any code is written**:

```gitignore
# Node
node_modules/
.next/
out/
.pnpm-store/

# Python
__pycache__/
*.pyc
*.pyo
.venv/
venv/
env/
*.egg-info/
dist/
build/

# Env files — NEVER commit
.env
.env.local
.env.*.local
.env.production
.env.development

# Supabase
supabase/.temp/
supabase/.branches/

# IDE
.vscode/
.idea/
*.swp
.DS_Store

# Build artifacts
*.log
coverage/
.pytest_cache/
.mypy_cache/

# Vercel
.vercel

# Railway
.railway/
```

---

## Directory Structure

```
enlaye-dashboard/
├── CLAUDE.md
├── ARCHITECTURE.md
├── IMPLEMENTATION.md
├── WORKSTREAMS.md
├── CONVENTIONS.md
├── README.md                         # for reviewers, created in Phase 6
├── .gitignore
│
├── frontend/                         # Track A — Next.js on Vercel
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # landing / upload
│   │   ├── portfolios/
│   │   │   └── [id]/
│   │   │       ├── page.tsx          # dashboard
│   │   │       └── components/       # page-specific components
│   │   └── api/
│   │       └── ml/
│   │           ├── ingest/route.ts   # proxies to Python with bearer
│   │           └── train/route.ts
│   ├── components/                   # shared components (shadcn/ui + custom)
│   │   └── ui/                       # shadcn/ui generated
│   ├── lib/
│   │   ├── supabase.ts               # client factories
│   │   ├── api.ts                    # typed API wrappers
│   │   └── utils.ts
│   ├── hooks/                        # TanStack Query hooks
│   ├── types/                        # shared TS types
│   ├── .env.local                    # gitignored
│   ├── .env.example                  # committed template
│   ├── package.json
│   └── tsconfig.json
│
├── ml-service/                       # Track B — FastAPI on Railway
│   ├── main.py                       # FastAPI app, routes
│   ├── cleaning.py                   # Task 1 logic
│   ├── models.py                     # Task 2 training
│   ├── schemas.py                    # Pydantic models
│   ├── db.py                         # Supabase client setup
│   ├── auth.py                       # bearer token middleware
│   ├── tests/
│   │   ├── test_cleaning.py
│   │   └── test_models.py
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env                          # gitignored
│   └── .env.example                  # committed template
│
└── supabase/                         # Track C — Supabase
    ├── config.toml
    ├── migrations/
    │   └── 20260418000000_initial_schema.sql
    └── functions/
        ├── embed/
        │   └── index.ts
        └── query/
            └── index.ts
```

---

## TypeScript / Next.js Conventions

### File and Export Style

- **Components:** PascalCase, one component per file, named export. `ProjectTable.tsx` exports `ProjectTable`.
- **Hooks:** `use` prefix, camelCase. `usePortfolio.ts`.
- **Utilities:** camelCase. `formatCurrency.ts`.
- **Types:** PascalCase. Live in `types/` or co-located if only used in one file.

### Server vs Client Components

Default to **server components**. Only add `"use client"` when you need:
- `useState`, `useEffect`, or other hooks
- Event handlers (onClick, onChange)
- Browser APIs (localStorage — don't use it, but as an example)
- Real-time subscriptions

Put the smallest possible wrapper component as `"use client"`, not the whole page.

### Data Fetching

- **Server components:** fetch directly from Supabase using a server-side client.
- **Client components:** use TanStack Query hooks for anything that might refetch. Create the hook in `hooks/`, don't inline queries.
- **Mutations (upload, train, etc.):** use TanStack Query `useMutation` with optimistic updates where sensible.

### Styling

- Tailwind for everything. No CSS modules, no styled-components.
- Use shadcn/ui primitives as the starting point. Customize via Tailwind classes on the primitives.
- Color: use CSS variables from shadcn/ui theme (`bg-background`, `text-foreground`, etc.) for theming consistency. Don't hardcode hex colors.
- Spacing: stick to Tailwind's scale. No `mt-[17px]`.

---

## Python / FastAPI Conventions

### Type Hints Everywhere

Every function signature has type hints. Pydantic models for request/response schemas. Use `Optional[X]` or `X | None` (Python 3.10+) consistently within a file.

```python
# Good
def impute_median(df: pd.DataFrame, column: str) -> float:
    ...

# Bad
def impute_median(df, column):
    ...
```

### Pydantic for Boundaries

Request and response bodies are Pydantic models, defined in `schemas.py`. They map 1:1 to the types in ARCHITECTURE.md § API Contracts. If a contract changes, both sides change in the same commit.

```python
# schemas.py
from pydantic import BaseModel

class IngestRequest(BaseModel):
    portfolio_id: str
    storage_path: str

class CleaningReport(BaseModel):
    imputations: list[Imputation]
    type_coercions: list[TypeCoercion]
    rows_rejected: int

class IngestResponse(BaseModel):
    portfolio_id: str
    row_count: int
    cleaning_report: CleaningReport
    anomaly_count: int
```

### FastAPI Route Style

- One file per domain (`cleaning.py`, `models.py`), imported into `main.py`.
- Routes at top of `main.py`, logic in the domain files.
- Always use dependency injection for shared resources (Supabase client, auth).

### Pandas Idioms

- Prefer vectorized operations over `.apply(lambda)` when performance matters.
- Never mutate DataFrames in-place without commenting why.
- When filtering by completed status, use a named boolean mask: `completed_mask = df['final_status'] == 'Completed'` — then reuse.

---

## Database Conventions

- **Table names:** plural, snake_case. `projects`, `document_chunks`.
- **Primary keys:** always `id uuid primary key default gen_random_uuid()`.
- **Foreign keys:** `<table_singular>_id`, e.g. `portfolio_id`. Always with `references` and `on delete cascade` when children should die with parents.
- **Timestamps:** `created_at timestamptz default now()`. Add `updated_at` only if you'll maintain it.
- **Booleans:** positive naming. `is_complete`, not `is_not_complete`.
- **JSONB:** for flexible/sparse data (anomaly_flags, feature_importances). Never for data that should have its own column.

### Migrations

- One migration per feature/change. Don't edit old migrations that are already applied.
- Filename: `YYYYMMDDHHMMSS_short_description.sql`.
- Every migration reversible in principle (even if we don't write the `down` — so no `DROP COLUMN` unless we really mean it).

---

## Comments and Notes

Comments are a tool for future-you. Be generous with *why*, stingy with *what*.

### When to Comment

**Always comment:**
- Why a non-obvious design choice was made (`// WHY: median not mean because construction data has outliers`)
- Assumptions that could later be wrong (`// NOTE: assumes all dates are UTC`)
- Anything security-relevant (`// SECURITY: this key is from Edge Function secrets, never from frontend`)
- TODOs with owner and context (`// TODO(claude): handle PDFs >10MB — currently errors`)

**Don't comment:**
- What the code obviously does (`// loops over the array`)
- Restating the function name (`// function that gets the user`)

### Comment Prefixes

Use these consistently:

| Prefix | Meaning | Example |
|---|---|---|
| `// NOTE:` | Context future readers need | `// NOTE: column order matters — matches pgvector index` |
| `// WHY:` | Rationale for a non-obvious choice | `// WHY: sklearn's default solver is 'lbfgs', better for small datasets` |
| `// TODO(claude):` | Planned work | `// TODO(claude): add retry on OpenRouter 429` |
| `// FIXME:` | Known bug | `// FIXME: CSV with non-UTF-8 encoding throws` |
| `// SECURITY:` | Security-sensitive | `// SECURITY: never log this, contains service_role key in URL` |
| `// PERF:` | Performance-relevant note | `// PERF: this query scans all chunks, fine for <10k but reconsider at scale` |

### Commit-Level Documentation

- If a change isn't self-explanatory from the diff, explain in the commit body.
- If a change impacts another track, mention it in the commit body AND update WORKSTREAMS.md Session Log.

---

## Error Handling

### Frontend

- Every `useMutation` has `onError` that shows the user a toast (shadcn/ui `sonner`).
- Every page has a top-level error boundary (Next.js `error.tsx`).
- Never silently swallow errors. At minimum, log them.

### Python

- Use FastAPI's `HTTPException` for user-facing errors with proper status codes.
- Catch specific exceptions, not bare `except:`. 
- Log errors with context (portfolio_id, not whole request body) using Python's `logging` module.

### Edge Functions

- Return explicit error JSON: `{ error: "description", code: "INTERNAL_ERROR" }`.
- Always return HTTP 200 with error in body for expected errors; 500 only for unexpected exceptions.
- `console.error` the full error for debugging; return a safe message to the client.

---

## Testing Philosophy

**We're not shooting for 100% coverage.** We're shooting for confidence in the parts that matter.

**Tests to write:**
- ML cleaning functions (median imputation, anomaly flagging) — pytest, using the 15-row sample as fixture
- ML model training produces correct feature lists for both models
- Critical frontend utils (formatting, validation) — simple Jest/Vitest

**Tests NOT to write for this project:**
- End-to-end tests (Playwright) — too expensive for the timeline
- Component snapshot tests — churn-heavy, low value
- API route tests — covered by manual testing in the dashboard

Keep tests next to the code: `ml-service/tests/test_cleaning.py` tests `cleaning.py`. Don't build a test empire.

---

## Anti-Patterns

Things that look helpful but cause problems. Don't do these, even if tempted.

### General
- ❌ **Silent deviations from IMPLEMENTATION.md.** If you're doing something different than planned, say so in the session log.
- ❌ **"Quick fixes" with no comment.** Any hack needs a FIXME note.
- ❌ **Renaming things "for consistency."** Not unless it's in a planned refactor.

### Frontend
- ❌ **Fetching inside `useEffect`.** Use TanStack Query.
- ❌ **Prop drilling beyond 2 levels.** Context or Query cache.
- ❌ **Adding a dependency for a one-line helper.** Write it yourself.
- ❌ **`localStorage` / `sessionStorage` / `window` access in server components.** Will break the build.
- ❌ **`any` type.** Use `unknown` and narrow, or type it properly.

### Python
- ❌ **Mutable default arguments.** `def f(x=[])` will haunt you.
- ❌ **Bare `except:`.** Catch specific exceptions.
- ❌ **Importing from deep inside a package** (`from pandas.core.foo import bar`). Use public API.
- ❌ **Training models with 100% accuracy and not questioning it.** On 9 rows, that's a red flag, not a success.

### Supabase
- ❌ **Direct DB queries from the frontend using service_role key.** Only anon key in browser.
- ❌ **Editing migrations that have been applied to prod.** Write a new one.
- ❌ **Putting secrets in Edge Function code.** Use `Deno.env.get()`.

---

## Frontend Design Principles

The design partner speaking. Non-negotiables for the UI:

### Hierarchy and Focus
- Every screen has exactly **one primary action**. Make it visually dominant.
- Secondary actions are demoted visually (outline buttons, not solid).
- Destructive actions (delete) require a confirmation step and use danger colors.

### Information Density
- Dashboard screens: dense but organized. Use cards to group related data.
- Empty states: always explain what the user can do next, with a clear CTA.
- Loading states: show skeleton screens, not spinners, for known-shape content.

### Typography
- Use shadcn/ui's type scale. Don't invent new font sizes.
- Headings establish hierarchy. H1 per page, H2 for sections, H3 sparingly.
- Numbers in tables: tabular figures (`font-variant-numeric: tabular-nums`) for alignment.

### Color
- Monochrome base + 1 accent. No rainbow dashboards.
- Status colors (red/yellow/green) only for actual status — not decoration.
- Anomaly flags: red background, white text, small pill shape.
- Confidence indicators: small colored dot (green/yellow/gray), not a full badge.

### Motion
- Subtle. 150-250ms transitions. No bouncing, no spinning.
- Loading spinners only when operation takes > 500ms.

### Accessibility
- Every interactive element keyboard-accessible.
- Focus rings visible (don't `outline: none` without a replacement).
- Color contrast ratio ≥ 4.5:1 for text. shadcn/ui defaults meet this; don't override.
- Form inputs always have labels (can be visually hidden, but present in DOM).

### The "5-Second Test"
Before shipping any screen: close your eyes for 10 seconds, open them, and look at the screen for 5 seconds. Can you tell what it's for and what action to take? If not, the hierarchy is wrong. Fix it before moving on.

---

## Updating This File

When a new pattern gets established during the build, add it here immediately. Do not let conventions live only in your head. The goal is that a fresh Claude Code session reading this file from scratch could continue the project in the same style.

Add new conventions under the appropriate section. If something is truly new, add a section for it.

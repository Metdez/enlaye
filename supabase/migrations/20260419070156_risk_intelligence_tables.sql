-- ============================================================
-- Risk intelligence tables — Phase 8a
-- ============================================================
-- WHY three new tables instead of columns on `projects`:
--   1. `projects` schema stays stable; ingest / training code untouched.
--   2. Derived outputs (scores, rules, segments) are recomputable; keeping
--      them separate makes idempotent refresh a DELETE + INSERT per
--      portfolio without touching source-of-truth rows.
--   3. Future phases can attach `computed_at` audit logs without widening
--      the projects row.
--
-- All three cascade on `projects.id` / `portfolios.id` so deleting a
-- portfolio cleans its derived artifacts. All three are cheap to rebuild
-- from scratch (the `/analyze` endpoint runs across the portfolio and
-- replaces the rows).
-- ============================================================

-- ---- risk_scores ------------------------------------------------------
-- One row per project with a 0-100 composite score + jsonb breakdown
-- describing each sub-score and weight (so the UI can render "why").
create table risk_scores (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  score numeric not null,
  -- {"subscores": {"type_risk": 0.72, ...}, "weights": {...}, "flags": [...]}
  breakdown jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),

  constraint risk_score_range check (score >= 0 and score <= 100),
  -- one score per project — upserts happen via DELETE + INSERT per refresh,
  -- but the uniqueness guarantee is helpful if we switch to ON CONFLICT.
  constraint risk_scores_project_unique unique (project_id)
);

create index risk_scores_portfolio_id_idx on risk_scores(portfolio_id);
create index risk_scores_score_idx on risk_scores(portfolio_id, score desc);

-- ---- heuristic_rules --------------------------------------------------
-- One row per derived rule. Scope is the segment selector (e.g.
-- "project_type=Infrastructure" or "size_bucket=large"); outcome is the
-- binary event (e.g. "high_overrun"). Rate is the segment's observed rate,
-- with a Wilson 95% CI and n.
create table heuristic_rules (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  scope text not null,          -- "project_type=Infrastructure", "region=Northeast", "size_bucket=large"
  outcome text not null,        -- "high_overrun", "high_delay", "any_safety_incident", "any_dispute"
  rate numeric not null,
  sample_size int not null,
  ci_low numeric not null,
  ci_high numeric not null,
  confidence text not null,     -- 'low' | 'medium' | 'high'
  computed_at timestamptz not null default now(),

  constraint rule_rate_range check (rate >= 0 and rate <= 1),
  constraint rule_ci_valid check (ci_low >= 0 and ci_high <= 1 and ci_low <= ci_high),
  constraint rule_confidence_valid check (confidence in ('low', 'medium', 'high'))
);

create index heuristic_rules_portfolio_id_idx on heuristic_rules(portfolio_id);
-- Salience-ordered reads (the UI sorts by "most actionable first"):
create index heuristic_rules_salience_idx
  on heuristic_rules(portfolio_id, sample_size desc, rate desc);

-- ---- project_segments --------------------------------------------------
-- Per-project derived features: size bucket, normalized delay, cluster id.
-- Kept separate from `projects` so the cleaning pipeline stays deterministic
-- and segment math can evolve without migrating the source table.
create table project_segments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  size_bucket text not null,       -- 'small' | 'medium' | 'large'
  normalized_delay numeric,        -- delay_days / (actual_duration_days + 1); null if either is null
  cluster_id int,                  -- KMeans cluster assignment within the portfolio; null if n<k*3
  computed_at timestamptz not null default now(),

  constraint size_bucket_valid check (size_bucket in ('small', 'medium', 'large')),
  constraint project_segments_project_unique unique (project_id)
);

create index project_segments_portfolio_id_idx on project_segments(portfolio_id);
create index project_segments_cluster_idx on project_segments(portfolio_id, cluster_id);

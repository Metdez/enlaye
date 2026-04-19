-- ============================================================
-- projects.source — provenance column for manual vs. CSV entries
-- ============================================================
-- WHY: Phase 8c introduces add/edit/delete project flows from the UI.
-- Reviewers need to distinguish user-entered projects from CSV-imported
-- ones so trust in the aggregates is explicit. Existing rows are CSV by
-- origin (they came through /ingest); default preserves that.
--
-- The constraint is a simple CHECK rather than a Postgres enum so we can
-- widen the allowed values later (e.g. 'api', 'scraped') with an ALTER
-- TABLE that doesn't require an ALTER TYPE dance.
-- ============================================================

alter table projects
  add column if not exists source text not null default 'csv';

alter table projects
  add constraint projects_source_valid
  check (source in ('csv', 'manual'));

-- WHY: the Projects table UI filters by `source` for the provenance
-- badge; small index keeps that scan fast once manual entries accumulate.
create index if not exists projects_source_idx on projects(portfolio_id, source);

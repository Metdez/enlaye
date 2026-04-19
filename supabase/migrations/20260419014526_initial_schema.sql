-- ============================================================
-- Initial schema — Enlaye Construction Risk Dashboard (Phase 1)
-- Source of truth: ARCHITECTURE.md § Database Schema
-- WHY: five tables mirror the data flow CSV → portfolios → projects →
-- model_runs, with documents + document_chunks for RAG (Phase 5).
-- ============================================================

-- ---- Extensions ----
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- ---- Portfolios — one per CSV upload ----
create table portfolios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cleaning_report jsonb default '{}'::jsonb,
  row_count int default 0,
  anomaly_count int default 0,
  created_at timestamptz default now()
);

-- ---- Projects — cleaned rows from the uploaded CSV ----
create table projects (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  project_id_external text,
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
  final_status text,
  actual_duration_days int,
  anomaly_flags jsonb default '[]'::jsonb
);

create index projects_portfolio_id_idx on projects(portfolio_id);
create index projects_final_status_idx on projects(final_status);

-- ---- Model runs — naive + pre_construction results side by side ----
-- WHY: two rows per training, one per model_type, preserves the leakage
-- comparison that the showcase feature hinges on.
create table model_runs (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  model_type text not null,
  accuracy numeric,
  feature_importances jsonb,
  features_used text[],
  n_training_samples int,
  created_at timestamptz default now(),

  constraint model_type_valid check (model_type in ('naive', 'pre_construction'))
);

create index model_runs_portfolio_model_idx on model_runs(portfolio_id, model_type);

-- ---- Documents — uploaded project docs (PDF/DOCX/TXT) ----
create table documents (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  chunk_count int default 0,
  embedding_status text default 'pending',
  uploaded_at timestamptz default now()
);

create index documents_portfolio_id_idx on documents(portfolio_id);

-- ---- Document chunks — text + 384-dim gte-small embeddings ----
-- WHY: vector(384) matches Supabase.ai gte-small output. Not 1536.
create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  embedding vector(384),
  created_at timestamptz default now()
);

-- WHY: IVFFlat with 100 lists gives fast cosine search at our scale.
create index document_chunks_embedding_idx on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index document_chunks_portfolio_id_idx on document_chunks(portfolio_id);

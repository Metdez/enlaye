-- ============================================================
-- Documents RAG pipeline — bucket, policies, webhook trigger
-- Phase 5 · Enlaye Construction Risk Dashboard
-- ============================================================
-- WHY: this migration stands up the end-to-end upload → embed path
-- for the RAG chat feature. The full flow:
--
--   1. User drops a PDF/DOCX/TXT in the dashboard.
--   2. Frontend uploads the binary to the `documents-bucket` Storage
--      bucket under `portfolios/<portfolio_id>/docs/<timestamp>-<filename>`
--      (the `docs/` sub-prefix keeps document uploads separate from CSV
--      uploads, and the timestamp prevents collisions on re-upload).
--   3. Frontend (or a server action) inserts a row into
--      `public.documents` referencing the storage_path.
--   4. The AFTER INSERT trigger below fires and calls `pg_net` →
--      `net.http_post` against the `embed` Edge Function, passing
--      the full new row as JSON.
--   5. The `embed` function downloads the object with service_role,
--      extracts text, chunks it, calls Supabase.ai `gte-small` to
--      produce 384-dim vectors, and inserts rows into
--      `document_chunks` (see 20260419014526_initial_schema.sql).
--   6. The `query` Edge Function later does cosine-similarity retrieval
--      over `document_chunks.embedding` for the chat interface.
--
-- Everything here is idempotent: bucket uses ON CONFLICT DO NOTHING,
-- policies use `create policy` (migration will no-op on re-apply once
-- merged — rerun requires `supabase db reset`), trigger uses DROP IF
-- EXISTS, function uses CREATE OR REPLACE.
-- ============================================================

-- ============================================================
-- 1. Storage bucket — documents-bucket (private, 25 MB cap)
-- ============================================================
-- WHY: separate from `portfolios-uploads` because the mime-types,
-- size cap, and downstream processing (RAG embed vs. CSV ingest)
-- are different. Keeping them siloed also simplifies bucket-scoped
-- RLS and makes it obvious which objects flow into which pipeline.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents-bucket',
  'documents-bucket',
  false,
  -- 25 MB — PDFs and DOCX project specs can be chunky.
  25 * 1024 * 1024,
  -- NOTE: application/octet-stream is included because some browsers
  -- mis-label .docx uploads, same reasoning as portfolios-uploads.
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- ============================================================
-- 2. Storage RLS policies — anon demo mode, portfolios/* prefix
-- ============================================================
-- WHY: mirrors the pattern in 20260419030649_storage_policies_anon_demo.sql.
-- Same caveat applies: this is single-user demo scoping. A multi-user
-- build must replace these with signed-URL issuance or `auth.uid()`-bound
-- policies. Tracked in ARCHITECTURE.md § Security Model.

-- Insert (upload) — anon can create objects under portfolios/* in this bucket only.
create policy "documents_bucket_anon_insert" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'documents-bucket'
    and (storage.foldername(name))[1] = 'portfolios'
  );

-- Select (download) — anon read under the same prefix. The embed Edge
-- Function uses service_role to fetch objects, so this grant is for
-- the UI (e.g., a "view original" link in the chat sidebar).
create policy "documents_bucket_anon_select" on storage.objects
  for select to anon
  using (
    bucket_id = 'documents-bucket'
    and (storage.foldername(name))[1] = 'portfolios'
  );

-- Delete — allow re-upload-after-failure flows.
create policy "documents_bucket_anon_delete" on storage.objects
  for delete to anon
  using (
    bucket_id = 'documents-bucket'
    and (storage.foldername(name))[1] = 'portfolios'
  );

-- WHY no UPDATE: Storage SDK uses INSERT (+ optional DELETE) for uploads.

-- ============================================================
-- 3. pg_net — enable for outbound HTTP from Postgres
-- ============================================================
-- WHY: Supabase hosts pg_net in the `extensions` schema by convention.
-- Placing it there keeps search_path clean and matches platform defaults.
create extension if not exists pg_net with schema extensions;

-- ============================================================
-- 4. Webhook trigger — documents INSERT → embed Edge Function
-- ============================================================
-- WHY: we use a Postgres trigger (not a Supabase Database Webhook in the
-- cloud UI) so the wiring lives in source control alongside the schema.
-- When a new `documents` row lands, we POST the full row to the `embed`
-- Edge Function, which does the actual download + chunk + embed work
-- asynchronously. Keeps the insert fast and non-blocking from the caller's
-- perspective (pg_net is fire-and-forget).

create or replace function public.trigger_embed_document()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_supabase_url text := current_setting('app.settings.supabase_url', true);
  v_service_key  text := current_setting('app.settings.service_role_key', true);
begin
  -- NOTE: if the GUCs aren't set, current_setting(..., true) returns NULL
  -- rather than raising. We still attempt the POST so the failure surfaces
  -- in pg_net's response table instead of silently swallowing the insert.
  perform net.http_post(
    url     := coalesce(v_supabase_url, '') || '/functions/v1/embed',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(v_service_key, '')
    ),
    body    := jsonb_build_object('record', row_to_json(NEW))
  );
  return NEW;
end;
$$;

-- WHY drop-then-create: `create trigger` has no OR REPLACE form in Postgres.
drop trigger if exists documents_embed_trigger on public.documents;
create trigger documents_embed_trigger
  after insert on public.documents
  for each row
  execute function public.trigger_embed_document();

-- ============================================================
-- 5. app.settings.* GUCs — MANUAL STEP, intentionally commented
-- ============================================================
-- SECURITY: the service_role key must never be committed to git. The two
-- statements below are the canonical way to set the GUCs that
-- `trigger_embed_document()` reads. Run them yourself (via `supabase db
-- execute` or psql against the cloud DB) after this migration is applied,
-- substituting real values. Do NOT uncomment and commit with real values.
--
-- alter database postgres set app.settings.supabase_url = '<SUPABASE_URL>';
-- alter database postgres set app.settings.service_role_key = '<SERVICE_ROLE_KEY>';
--
-- Preferred flow:
--   1. `supabase secrets set SUPABASE_URL=... SERVICE_ROLE_KEY=...`
--      (these power the Edge Function itself)
--   2. Separately, run the two `alter database postgres set ...` statements
--      above against the cloud DB so the trigger can reach the function.
--   3. Confirm with:
--        select current_setting('app.settings.supabase_url', true);
--        select current_setting('app.settings.service_role_key', true);
--      from a SQL editor session (values persist across new sessions after
--      a `select pg_reload_conf()` or a DB restart — Supabase handles this).
--
-- Until those are set, the trigger will POST to '/functions/v1/embed' with
-- an empty Bearer token and the embed function will 401. That's the signal
-- that this manual step was skipped.
-- ============================================================

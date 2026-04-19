-- ============================================================
-- Storage RLS policies — single-user demo mode
-- WHY: the `portfolios-uploads` bucket is created private, and
-- `storage.objects` has RLS enabled by default with zero policies,
-- which means anon writes are blocked. The Phase 2 frontend uploads
-- CSVs directly with the anon key, so we permit exactly the minimum
-- surface needed for the demo: anon can insert, select, and delete
-- objects under the `portfolios/` prefix of this one bucket.
--
-- For a multi-user build this must be replaced by one of:
--   (a) server-side signed upload URLs (anon never writes directly), or
--   (b) `auth.uid()`-scoped policies tying objects to a specific user.
-- Tracked in ARCHITECTURE.md § Security Model.
-- ============================================================

-- Insert (upload) — anon can create objects under portfolios/* in this bucket only.
create policy "portfolios_uploads_anon_insert" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'portfolios-uploads'
    and (storage.foldername(name))[1] = 'portfolios'
  );

-- Select (download) — same namespace restriction. Needed so the frontend
-- can generate signed/public URLs post-upload if desired; today it doesn't,
-- but the ML service uses service_role so this grant is purely for the UI.
create policy "portfolios_uploads_anon_select" on storage.objects
  for select to anon
  using (
    bucket_id = 'portfolios-uploads'
    and (storage.foldername(name))[1] = 'portfolios'
  );

-- Delete — allow overwrite-by-delete flows (re-upload after a failed ingest).
create policy "portfolios_uploads_anon_delete" on storage.objects
  for delete to anon
  using (
    bucket_id = 'portfolios-uploads'
    and (storage.foldername(name))[1] = 'portfolios'
  );

-- We intentionally do NOT grant UPDATE: the Supabase Storage SDK uses
-- INSERT + (optionally) DELETE for uploads, not UPDATE.

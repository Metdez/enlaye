-- ============================================================
-- Storage bucket: portfolios-uploads
-- Phase 2 · Task A1 — Enlaye Construction Risk Dashboard
-- ============================================================
-- WHY: CSV uploads from the dashboard land here. The Python ML service
-- pulls the object down via service_role, runs cleaning.py, and writes
-- rows to `projects`. The bucket is PRIVATE — no anon reads, no anon
-- writes. Single-user demo mode per ARCHITECTURE.md § Security Model:
-- frontend uploads through a signed URL minted by a server action;
-- Python service reads with service_role. RLS policies will be added in
-- a later phase when we introduce per-user portfolios.
-- ============================================================

-- WHY: insert-on-conflict keeps the migration idempotent across
-- `supabase db reset --local` runs and fresh cloud applies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portfolios-uploads',
  'portfolios-uploads',
  false,
  -- 10 MB — generous for CSVs, hard cap against a runaway upload
  10 * 1024 * 1024,
  -- NOTE: some browsers (older Safari, Windows Edge on certain MIME registries)
  -- label .csv as application/vnd.ms-excel or application/octet-stream.
  -- Accept all three so users don't hit a confusing "unsupported file type"
  -- error when the file is genuinely a CSV.
  array['text/csv', 'application/vnd.ms-excel', 'application/octet-stream']
)
on conflict (id) do nothing;

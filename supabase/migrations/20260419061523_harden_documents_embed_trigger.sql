-- ============================================================
-- Harden documents → embed webhook trigger
-- ============================================================
-- WHY: in 20260420000000_documents_rag_pipeline.sql we installed an
-- AFTER INSERT trigger on `documents` that calls `net.http_post` to
-- fire the `embed` Edge Function. Hitting the cloud DB we've seen
-- `XX000 "Out of memory"` raised from `net.http_post` on what should
-- be a trivial metadata insert. Root cause is probably either
--   (a) the `app.settings.supabase_url` / `service_role_key` GUCs not
--       being set, so the URL resolves to an empty-host relative
--       string that pg_net rejects in a badly-handled error path, or
--   (b) a pg_net platform-version regression on cloud.
--
-- Either way the INSERT itself has no reason to fail — the row is
-- small and self-contained. This migration replaces the trigger
-- function with a defensive version that:
--
--   1. Returns early (no POST, no error) when the GUCs are missing
--      or empty. The row lands; embedding can be kicked off later.
--   2. Wraps the `net.http_post` call in an EXCEPTION block so any
--      pg_net failure surfaces as a NOTICE and the INSERT still
--      commits. Webhook delivery is best-effort; the row is the
--      source of truth.
--
-- The trigger still fires; it just can no longer block document
-- registration. When pg_net recovers / GUCs are set, the webhook
-- resumes automatically.
-- ============================================================

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
  -- Guard: without a valid base URL there's nothing to POST to. Returning
  -- early is preferable to letting pg_net choke on an empty-host URL.
  if v_supabase_url is null or v_supabase_url = '' then
    raise notice 'trigger_embed_document: app.settings.supabase_url not set - skipping embed webhook for document %', NEW.id;
    return NEW;
  end if;

  -- Best-effort webhook: any failure here is logged and swallowed so the
  -- INSERT commits. The row is the system of record; the webhook is
  -- reschedulable (manual re-insert, cron worker, or a future worker that
  -- polls documents WHERE embedding_status = 'pending').
  begin
    perform net.http_post(
      url     := rtrim(v_supabase_url, '/') || '/functions/v1/embed',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || coalesce(v_service_key, '')
      ),
      body    := jsonb_build_object('record', row_to_json(NEW))
    );
  exception when others then
    raise notice 'trigger_embed_document: pg_net failure (% / %) - document % registered without embed dispatch',
      sqlstate, sqlerrm, NEW.id;
  end;

  return NEW;
end;
$$;

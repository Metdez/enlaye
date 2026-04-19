-- ============================================================
-- match_document_chunks RPC — pgvector cosine similarity search
-- Phase 5 · Enlaye Construction Risk Dashboard
-- ============================================================
-- WHY: the `query` Edge Function needs to do a scoped cosine-similarity
-- search over `document_chunks` for one portfolio at a time, and return
-- a small top-k result with the similarity score already materialized.
-- Doing that from PostgREST is awkward (the `<=>` operator cannot be
-- used through the URL DSL), so we wrap it in a SQL function and call
-- it via `supabase.rpc('match_document_chunks', {...})`.
--
-- Signature is stable: changing argument names or types will break the
-- Edge Function. If you need to evolve the return shape, add a new
-- function (e.g. match_document_chunks_v2) rather than mutating this
-- one — the RPC name is part of the public contract.
--
-- WHY security definer: not used here. This function reads only public
-- tables that the service_role key can already see, and callers from
-- the `query` Edge Function authenticate with service_role, so no
-- elevation is required.
--
-- WHY language sql + stable: the body is a single query with no side
-- effects, which lets the planner inline it and reuse the ivfflat index
-- on `document_chunks.embedding` for the ORDER BY.
-- ============================================================

create or replace function public.match_document_chunks(
  p_portfolio_id   uuid,
  query_embedding  vector(384),
  match_threshold  float,
  match_count      int
)
returns table (
  id          uuid,
  document_id uuid,
  chunk_text  text,
  similarity  float
)
language sql
stable
as $$
  -- WHY: cosine *distance* (`<=>`) is what pgvector's ivfflat index
  -- supports with vector_cosine_ops. We convert to cosine *similarity*
  -- (1 - distance) for the return value + threshold check because
  -- downstream consumers want "higher = closer" semantics.
  select
    dc.id,
    dc.document_id,
    dc.chunk_text,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.portfolio_id = p_portfolio_id
    and 1 - (dc.embedding <=> query_embedding) >= match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- WHY: explicit grants. The function is called by the `query` Edge
-- Function using the service_role key, but we also grant to `anon` so
-- that a future client-side fallback path (or local curl tests with
-- the anon key) keeps working without a schema migration.
grant execute on function public.match_document_chunks(uuid, vector(384), float, int)
  to anon, authenticated, service_role;

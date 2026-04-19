// Edge Function: embed
// ---------------------------------------------------------------
// Triggered by a database webhook on `documents` insert. Downloads
// the uploaded file from Supabase Storage, extracts and chunks
// text, generates a 384-dim `gte-small` embedding per chunk, and
// writes rows to `document_chunks`.
//
// Phase 5 scope — this is a stub. See ARCHITECTURE.md
// § Service Boundaries → `embed` for the target flow.
// ---------------------------------------------------------------

import "@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req) => {
  // TODO(claude): Phase 5 — download the storage file, chunk text,
  // generate gte-small embeddings, insert into document_chunks.
  return new Response(
    JSON.stringify({ status: "not_implemented" }),
    { status: 501, headers: { "Content-Type": "application/json" } },
  );
});

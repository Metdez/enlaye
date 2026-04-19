// Edge Function: query
// ---------------------------------------------------------------
// HTTP endpoint called by the frontend chat UI.
//   1. Receive { portfolio_id, question, top_k?, threshold? }
//   2. Embed the question with gte-small (384 dims)
//   3. Cosine-similarity search against document_chunks
//   4. If no chunk ≥ threshold → answer: null, confidence: "low"
//   5. Otherwise call OpenRouter (deepseek/deepseek-v3.2) with
//      the chunks as context and return answer + sources.
//
// Phase 5 scope — this is a stub. See ARCHITECTURE.md
// § Service Boundaries → `query` for the target flow and shape.
// ---------------------------------------------------------------

import "@supabase/functions-js/edge-runtime.d.ts";

interface QueryRequest {
  portfolio_id: string;
  question: string;
  top_k?: number;
  threshold?: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let body: QueryRequest;
  try {
    body = (await req.json()) as QueryRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!body?.portfolio_id || !body?.question) {
    return new Response(
      JSON.stringify({ error: "portfolio_id and question are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // TODO(claude): Phase 5 — embed question, pgvector search, OpenRouter call.
  return new Response(
    JSON.stringify({
      answer: null,
      sources: [],
      confidence: "low",
      status: "not_implemented",
    }),
    { status: 501, headers: { "Content-Type": "application/json" } },
  );
});

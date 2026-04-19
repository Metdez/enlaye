// ============================================================
// Edge Function: query
// ------------------------------------------------------------
// HTTP endpoint backing the frontend chat UI. End-to-end flow:
//
//   1. Validate method (POST) and JSON body
//      ({ portfolio_id, question, top_k?, threshold? }). We require a
//      UUID-shaped portfolio_id and a non-empty trimmed question.
//   2. Clamp top_k to [1, 20] and threshold to [0, 1]. Defaults: 3, 0.5.
//   3. Embed the question with Supabase.ai gte-small (mean_pool +
//      normalize) → 384-dim float array.
//   4. Call the `match_document_chunks` SQL RPC (see migration
//      20260420000100_match_document_chunks_rpc.sql) scoped to the
//      portfolio, with match_threshold + match_count.
//   5. If zero hits → { answer: null, sources: [], confidence: 'low' }.
//   6. Join to `documents` to get filenames for citation cards.
//   7. Build a numbered-excerpt prompt ([C1], [C2], ...) and POST to
//      OpenRouter (deepseek/deepseek-v3.2 by default, overridable via
//      the OPENROUTER_MODEL env var). 25s AbortController timeout.
//   8. Confidence: top similarity ≥ 0.7 → 'high', else 'medium'.
//   9. Return { answer, sources: [{chunk_id, document_filename,
//      similarity, preview}], confidence }.
//
// WHY the RPC: PostgREST cannot express pgvector's `<=>` ORDER BY
// cleanly. Wrapping the query in a SQL function lets us keep the
// ivfflat index path and return a flat result shape. The RPC is
// created by the migration referenced above — if that migration has
// not been applied, this function 500s with a clear upstream error.
//
// SECURITY: uses SUPABASE_SERVICE_ROLE_KEY so we can read across
// document_chunks regardless of RLS, and OPENROUTER_API_KEY for the
// LLM call. Neither key must ever be surfaced in the response body.
// ============================================================

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// Supabase.ai is a global injected by the Edge Runtime — declare the
// minimal shape we use so TypeScript is happy locally and in CI.
declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run: (
        input: string,
        opts: { mean_pool: boolean; normalize: boolean },
      ) => Promise<number[]>;
    };
  };
};

// ---- Types ----------------------------------------------------------

interface QueryRequest {
  portfolio_id?: unknown;
  question?: unknown;
  top_k?: unknown;
  threshold?: unknown;
}

interface MatchedChunk {
  id: string;
  document_id: string;
  chunk_text: string;
  similarity: number;
}

interface SourceCard {
  chunk_id: string;
  document_filename: string;
  similarity: number;
  preview: string;
}

// ---- Constants ------------------------------------------------------

// WHY: 36-char canonical UUID with hyphens. We don't need strict RFC
// 4122 version checking — just a cheap shape guard so we don't ship
// garbage to the DB. Postgres will reject malformed casts anyway.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_TOP_K = 3;
const DEFAULT_THRESHOLD = 0.5;
const MAX_TOP_K = 20;
const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const PREVIEW_CHARS = 200;
const OPENROUTER_TIMEOUT_MS = 25_000;
const DEFAULT_MODEL = "deepseek/deepseek-v3.2";

const SYSTEM_PROMPT =
  "You are answering a question about construction project documents. " +
  "Use ONLY the provided excerpts. Cite sources inline using [C1], [C2], " +
  "etc. matching the numbered excerpts. If the excerpts don't answer the " +
  "question, say so.";

// ---- Helpers --------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

// WHY: the frontend may send top_k/threshold as numbers or strings
// (if serialized via URLSearchParams in a refactor). Coerce defensively,
// reject NaN, fall back to defaults for undefined/null.
function coerceNumber(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---- Handler --------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  // ---- 1. Parse body ----
  let body: QueryRequest;
  try {
    body = (await req.json()) as QueryRequest;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  // ---- 2. Validate ----
  const portfolio_id =
    typeof body.portfolio_id === "string" ? body.portfolio_id.trim() : "";
  const question =
    typeof body.question === "string" ? body.question.trim() : "";

  if (!UUID_RE.test(portfolio_id)) {
    return jsonResponse(
      { error: "portfolio_id must be a UUID" },
      400,
    );
  }
  if (question.length === 0) {
    return jsonResponse(
      { error: "question must be a non-empty string" },
      400,
    );
  }

  const top_k = Math.round(
    clamp(coerceNumber(body.top_k, DEFAULT_TOP_K), 1, MAX_TOP_K),
  );
  const threshold = clamp(
    coerceNumber(body.threshold, DEFAULT_THRESHOLD),
    0,
    1,
  );

  // ---- 3. Env sanity ----
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? DEFAULT_MODEL;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // SECURITY: don't leak which key is missing in production, but this
    // env-wiring failure is an operator error, not a user-facing one.
    return jsonResponse(
      { error: "Supabase env not configured" },
      500,
    );
  }
  if (!OPENROUTER_API_KEY) {
    return jsonResponse(
      { error: "OPENROUTER_API_KEY not configured" },
      500,
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 4. Embed the question ----
  let queryEmbedding: number[];
  try {
    const session = new Supabase.ai.Session("gte-small");
    queryEmbedding = await session.run(question, {
      mean_pool: true,
      normalize: true,
    });
  } catch (err) {
    console.error("[query] embedding failed", err);
    return jsonResponse({ error: "failed to embed question" }, 500);
  }

  // ---- 5. pgvector similarity search via RPC ----
  const { data: matchData, error: matchError } = await supabase.rpc(
    "match_document_chunks",
    {
      p_portfolio_id: portfolio_id,
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: top_k,
    },
  );

  if (matchError) {
    console.error("[query] match_document_chunks rpc failed", matchError);
    return jsonResponse(
      { error: "similarity search failed", detail: matchError.message },
      500,
    );
  }

  const matches = (matchData ?? []) as MatchedChunk[];

  // ---- 6. No hits → low confidence short-circuit ----
  if (matches.length === 0) {
    return jsonResponse({
      answer: null,
      sources: [] as SourceCard[],
      confidence: "low",
    });
  }

  // ---- 7. Resolve document filenames for citation cards ----
  const documentIds = Array.from(new Set(matches.map((m) => m.document_id)));
  const { data: docRows, error: docError } = await supabase
    .from("documents")
    .select("id, filename")
    .in("id", documentIds);

  if (docError) {
    console.error("[query] documents lookup failed", docError);
    return jsonResponse(
      { error: "failed to resolve document filenames" },
      500,
    );
  }

  const filenameById = new Map<string, string>();
  for (const row of docRows ?? []) {
    filenameById.set(row.id as string, (row.filename as string) ?? "unknown");
  }

  const sources: SourceCard[] = matches.map((m) => ({
    chunk_id: m.id,
    document_filename: filenameById.get(m.document_id) ?? "unknown",
    similarity: m.similarity,
    preview: m.chunk_text.slice(0, PREVIEW_CHARS),
  }));

  // ---- 8. Build prompt + call OpenRouter ----
  const excerpts = matches
    .map((m, i) => `[C${i + 1}] ${m.chunk_text}`)
    .join("\n\n");
  const userPrompt =
    `Excerpts:\n${excerpts}\n\nQuestion: ${question}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    OPENROUTER_TIMEOUT_MS,
  );

  let answer: string | null = null;
  try {
    const upstream = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          // WHY: OpenRouter attribution headers — surfaces us in their
          // dashboard and is the documented convention for non-anonymous
          // clients. Values are public (domain + product name).
          "HTTP-Referer": "https://enlaye.com",
          "X-Title": "Enlaye",
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
      },
    );

    if (!upstream.ok) {
      const bodyText = await upstream.text().catch(() => "");
      console.error(
        "[query] openrouter non-2xx",
        upstream.status,
        bodyText.slice(0, 500),
      );
      return jsonResponse(
        { error: "LLM request failed", status: upstream.status },
        502,
      );
    }

    const payload = await upstream.json();
    const content = payload?.choices?.[0]?.message?.content;
    answer = typeof content === "string" ? content : null;
  } catch (err) {
    const aborted =
      err instanceof DOMException && err.name === "AbortError";
    console.error(
      "[query] openrouter call threw",
      aborted ? "(timeout)" : err,
    );
    return jsonResponse(
      {
        error: aborted
          ? "LLM request timed out"
          : "LLM request failed",
      },
      502,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // ---- 9. Confidence band based on top similarity ----
  // WHY: matches are ordered by ascending distance (descending similarity)
  // from the RPC, so index 0 is the best hit.
  const topSimilarity = matches[0].similarity;
  const confidence: "high" | "medium" | "low" =
    topSimilarity >= HIGH_CONFIDENCE_THRESHOLD ? "high" : "medium";

  return jsonResponse({ answer, sources, confidence });
});

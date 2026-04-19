// ============================================================
// Edge Function: embed
// ------------------------------------------------------------
// Triggered by a Postgres database webhook when a new row is
// inserted into `documents`. End-to-end flow:
//
//   1. Parse + validate the webhook payload. We require
//      `record.id`, `record.portfolio_id`, `record.storage_path`.
//   2. Download the uploaded file from the `documents-bucket`
//      Storage bucket using the service_role key.
//   3. Extract plain text based on the filename extension:
//        .pdf  -> unpdf (pure-JS, Deno-compatible)
//        .docx -> mammoth.extractRawText
//        .txt  -> TextDecoder('utf-8')
//      Unknown extensions mark the document `failed` and return
//      200 so Postgres does not retry.
//   4. Chunk the text at ~400 whitespace tokens with 50 overlap.
//   5. For each chunk, generate a 384-dim gte-small embedding via
//      Supabase.ai (auto-injected in the Edge Runtime).
//   6. Bulk-insert rows into `document_chunks`.
//   7. Update the parent `documents` row:
//        chunk_count = <n>, embedding_status = 'complete'.
//
// On any thrown error we best-effort mark the document `failed`
// and still return 200 — see WHY notes below.
// ============================================================

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { extractText } from "unpdf";
import mammoth from "mammoth";

// Supabase.ai is a global injected by the Edge Runtime — declare
// the minimal shape we use so TypeScript is happy locally.
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

const STORAGE_BUCKET = "documents-bucket";
// WHY: 400 whitespace tokens ≈ ~500 BPE tokens, comfortably under
// gte-small's 512-token context window. Word-splitting is a
// deliberate approximation — we trade tokenizer fidelity for zero
// extra dependencies in the Edge Runtime. Drift is fine because
// embeddings degrade gracefully on near-boundary chunks.
const CHUNK_WORDS = 400;
const CHUNK_OVERLAP_WORDS = 50;
const MIN_CHUNK_CHARS = 20;

type WebhookPayload = {
  type?: string;
  table?: string;
  record?: {
    id?: string;
    portfolio_id?: string;
    filename?: string;
    storage_path?: string;
  };
};

// CORS — the function used to be called only from pg_net (server→server,
// no browser). Now the frontend invokes it directly via supabase-js, which
// requires CORS. Allow any origin for the demo; tighten if multi-tenant.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch (_err) {
    return json({ error: "invalid_json" }, 400);
  }

  const record = payload?.record;
  if (!record?.id || !record?.portfolio_id || !record?.storage_path) {
    return json({ error: "missing_required_fields" }, 400);
  }

  const documentId = record.id;
  const portfolioId = record.portfolio_id;
  const storagePath = record.storage_path;
  const filename = record.filename ?? storagePath.split("/").pop() ?? "";

  // SECURITY: the service_role key bypasses RLS. It's only read
  // from the Edge Function secrets (never shipped to the browser)
  // and is required here because (a) Storage downloads of
  // non-public buckets and (b) writes to document_chunks need to
  // happen server-side on behalf of the uploading user.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("embed: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return json({ error: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    console.log(
      `embed: start document=${documentId} path=${storagePath} name=${filename}`,
    );

    // --- 1. Download the file from Storage ---
    const { data: fileBlob, error: downloadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (downloadErr || !fileBlob) {
      throw new Error(
        `storage_download_failed: ${downloadErr?.message ?? "no body"}`,
      );
    }

    const arrayBuffer = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // --- 2. Extract text by extension ---
    const ext = filename.toLowerCase().split(".").pop() ?? "";
    let text = "";

    if (ext === "pdf") {
      const { text: pdfText } = await extractText(bytes, { mergePages: true });
      text = Array.isArray(pdfText) ? pdfText.join("\n") : pdfText;
    } else if (ext === "docx") {
      const result = await mammoth.extractRawText({ arrayBuffer });
      text = result.value ?? "";
    } else if (ext === "txt") {
      text = new TextDecoder("utf-8").decode(bytes);
    } else {
      // WHY: return 200 so the Postgres webhook doesn't loop
      // retry a file we structurally can't handle. We record the
      // reason on the document row so the UI can show it.
      console.warn(`embed: unsupported extension '${ext}' for ${documentId}`);
      await markFailed(
        supabase,
        documentId,
        `unsupported_extension:${ext || "none"}`,
      );
      return json({ status: "skipped", reason: "unsupported_extension" }, 200);
    }

    text = text.trim();
    if (!text) {
      console.warn(`embed: empty text extracted for ${documentId}`);
      await markFailed(supabase, documentId, "empty_text");
      return json({ status: "skipped", reason: "empty_text" }, 200);
    }

    // --- 3. Chunk ---
    const chunks = chunkText(text, CHUNK_WORDS, CHUNK_OVERLAP_WORDS)
      .filter((c) => c.length >= MIN_CHUNK_CHARS);

    if (chunks.length === 0) {
      console.warn(`embed: no usable chunks for ${documentId}`);
      await markFailed(supabase, documentId, "no_usable_chunks");
      return json({ status: "skipped", reason: "no_usable_chunks" }, 200);
    }

    console.log(`embed: ${chunks.length} chunks for ${documentId}`);

    // --- 4. Embed each chunk with gte-small (384-dim) ---
    const session = new Supabase.ai.Session("gte-small");
    const rows: Array<{
      document_id: string;
      portfolio_id: string;
      chunk_index: number;
      chunk_text: string;
      embedding: number[];
    }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await session.run(chunk, {
        mean_pool: true,
        normalize: true,
      });
      rows.push({
        document_id: documentId,
        portfolio_id: portfolioId,
        chunk_index: i,
        chunk_text: chunk,
        embedding,
      });
    }

    // --- 5. Bulk insert chunks ---
    const { error: insertErr } = await supabase
      .from("document_chunks")
      .insert(rows);

    if (insertErr) {
      throw new Error(`chunk_insert_failed: ${insertErr.message}`);
    }

    // --- 6. Mark document complete ---
    const { error: updateErr } = await supabase
      .from("documents")
      .update({
        chunk_count: rows.length,
        embedding_status: "complete",
      })
      .eq("id", documentId);

    if (updateErr) {
      throw new Error(`document_update_failed: ${updateErr.message}`);
    }

    console.log(
      `embed: done document=${documentId} chunks=${rows.length}`,
    );

    return json(
      { status: "complete", document_id: documentId, chunks: rows.length },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`embed: failure document=${documentId}: ${message}`);
    // WHY: we swallow the error and return 200. Postgres webhooks
    // (pg_net) will otherwise retry on non-2xx forever, which
    // would hammer Storage / Supabase.ai for a file that's never
    // going to parse. The `failed` status on the document row is
    // the canonical surface for failures — the UI reads it.
    await markFailed(supabase, documentId, message).catch((e) => {
      console.error(`embed: could not mark failed: ${e}`);
    });
    return json({ status: "failed", error: message }, 200);
  }
});

// ---- helpers ----------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function markFailed(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  documentId: string,
  reason: string,
): Promise<void> {
  // Truncate the reason so we don't blow past reasonable column
  // sizes if an underlying library dumps a multi-KB stack trace.
  const trimmed = reason.slice(0, 500);
  await supabase
    .from("documents")
    .update({ embedding_status: `failed:${trimmed}` })
    .eq("id", documentId);
}

/**
 * Whitespace-word chunker with overlap.
 *
 * WHY whitespace: the Edge Runtime has no tokenizer available for
 * gte-small without pulling a multi-MB WASM blob. Words are a
 * close-enough proxy for this use case (see CHUNK_WORDS note).
 */
function chunkText(
  text: string,
  size: number,
  overlap: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (overlap >= size) {
    throw new Error("chunk overlap must be smaller than chunk size");
  }

  const chunks: string[] = [];
  const step = size - overlap;
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + size);
    if (slice.length === 0) break;
    chunks.push(slice.join(" "));
    if (start + size >= words.length) break;
  }
  return chunks;
}

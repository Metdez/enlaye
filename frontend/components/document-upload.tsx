"use client";

// Client-side document upload widget for the portfolio detail page.
// WHY: mirrors the shape of [csv-upload.tsx](./csv-upload.tsx) so a
// reviewer sees a consistent state-machine idiom across the two upload
// surfaces. The flow is a deliberate two-step: Storage upload first, then
// `documents` row insert. The DB AFTER INSERT trigger (see
// supabase/migrations/20260420000000_documents_rag_pipeline.sql) is what
// fires the `embed` Edge Function — we don't call it directly. That
// ordering matters: if we inserted the row first and the Storage upload
// failed, the trigger would fire against a nonexistent object and the
// embed function would mark the row failed. Uploading first means the
// object is there the moment the trigger runs.
//
// WHY router.refresh() instead of optimistic update: the DocumentList
// sibling component is a server component by design (no client bundle
// for a read-only list). `router.refresh()` re-fetches it server-side.
// An optimistic row would also lie about `embedding_status: 'pending'`
// in a way that feels good until the trigger genuinely fires and the
// status flips; a full refresh keeps the UI honest about real DB state.

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Loader2 } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";

// WHY: matches the 25 MB cap on the `documents-bucket` Storage bucket
// (see 20260420000000_documents_rag_pipeline.sql). Enforcing client-side
// too gives fast feedback without a round-trip. Deliberately larger than
// the CSV bucket's 10 MB — project PDFs and DOCX specs run bigger than
// tabular exports.
const MAX_BYTES = 25 * 1024 * 1024;

// WHY: explicit MIME allowlist. react-dropzone's `accept` also enforces
// this, but some browsers report odd MIME types (e.g. empty string for
// .docx on older Firefox). Dual-checking gives us a clear error surface.
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

// NOTE: the extension map is only used by react-dropzone's `accept` prop;
// our own validation keys off MIME. Extensions are a UX hint, not a gate.
const ACCEPT_MAP = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
};

type Stage = "idle" | "uploading" | "inserting" | "processing" | "error";

// WHY: 'processing' covers the brief window between the row insert and the
// embed Edge Function flipping embedding_status. The DocumentList row will
// show the authoritative 'pending' → 'complete' / 'failed' state, but a
// short-lived label here keeps the upload widget honest while router.refresh()
// is in flight.
const STAGE_LABELS: Record<Exclude<Stage, "idle" | "error">, string> = {
  uploading: "Uploading to storage…",
  inserting: "Registering document…",
  processing: "Processing… (embedding will continue in background)",
};

// WHY: path segments must survive URL encoding + the bucket's RLS check
// `(storage.foldername(name))[1] = 'portfolios'`. Replace anything that
// isn't a letter/digit/dot/dash/underscore with `_`. Leading dots are
// stripped so a file named `.env.pdf` doesn't become an invisible object.
function sanitizeFilename(name: string): string {
  const trimmed = name.replace(/^\.+/, "");
  return trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function DocumentUpload({ portfolio_id }: { portfolio_id: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // WHY: re-entrancy guard — react-dropzone can double-fire in rare
  // drag-drop sequences, and we don't want two Storage writes racing for
  // the same path. Mirrors the pattern in csv-upload.tsx.
  const inFlight = useRef(false);

  const runUpload = useCallback(
    async (file: File) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setErrorMessage(null);

      try {
        // --- 1. Validate ---
        if (!ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
          throw new Error(
            `Unsupported file type "${file.type || "unknown"}". Upload a PDF, DOCX, or TXT.`,
          );
        }
        if (file.size > MAX_BYTES) {
          throw new Error(
            `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is 25 MB.`,
          );
        }

        const supabase = createBrowserSupabase();

        // --- 2. Upload to Storage ---
        // SECURITY: the `documents-bucket` is private. The RLS policy
        // `documents_bucket_anon_insert` allows anon uploads only under
        // the `portfolios/` prefix (see migration
        // 20260420000000_documents_rag_pipeline.sql). This matches the
        // demo-mode caveat on the CSV bucket — a multi-tenant build
        // would gate this by auth.uid() against a portfolio owner column.
        //
        // WHY the timestamp prefix: two uploads with the same filename
        // in the same portfolio would collide. We pass `upsert: false`
        // so a collision errors loudly instead of silently overwriting
        // a doc that may already be embedded. The timestamp makes real
        // collisions astronomically unlikely.
        setStage("uploading");
        const safeFilename = sanitizeFilename(file.name);
        const storagePath = `portfolios/${portfolio_id}/docs/${Date.now()}-${safeFilename}`;

        const { error: uploadErr } = await supabase.storage
          .from("documents-bucket")
          .upload(storagePath, file, {
            contentType: file.type,
            upsert: false,
          });
        if (uploadErr) {
          throw new Error(`Storage upload failed: ${uploadErr.message}`);
        }

        // --- 3. Insert documents row ---
        // WHY: the AFTER INSERT trigger `documents_embed_trigger` fires
        // here and POSTs the new row to the `embed` Edge Function, which
        // downloads, chunks, embeds, and flips embedding_status to
        // 'complete'. We do NOT call /embed directly.
        setStage("inserting");
        const { error: insertErr } = await supabase.from("documents").insert({
          portfolio_id,
          filename: file.name,
          storage_path: storagePath,
          embedding_status: "pending",
        });

        if (insertErr) {
          // FIXME(claude): the Storage object is now orphaned. Acceptable
          // for the single-user demo (same rationale as csv-upload.tsx's
          // orphaned-portfolio FIXME) — the user can re-drop and the path
          // gets a fresh timestamp. A multi-user build should DELETE the
          // just-uploaded object here before surfacing the error.
          throw new Error(`Failed to register document: ${insertErr.message}`);
        }

        // --- 4. Success — re-render the server-rendered list ---
        // WHY: brief 'processing' label so the user sees a transition rather
        // than a snap back to 'idle'. The list row owns the canonical state
        // (pending → complete/failed) once router.refresh() lands.
        setStage("processing");
        router.refresh();
        // Drop the processing label after a short window — the list will
        // have re-rendered with the real status by then.
        window.setTimeout(() => {
          setStage((s) => (s === "processing" ? "idle" : s));
        }, 1200);
      } catch (err) {
        setStage("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
      }
    },
    [portfolio_id, router],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      void runUpload(file);
    },
    [runUpload],
  );

  const busy =
    stage === "uploading" || stage === "inserting" || stage === "processing";

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    maxFiles: 1,
    maxSize: MAX_BYTES,
    accept: ACCEPT_MAP,
    noClick: false,
    noKeyboard: false,
    disabled: busy,
  });

  const stageLabel = busy ? STAGE_LABELS[stage] : null;

  const retry = () => {
    setStage("idle");
    setErrorMessage(null);
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={[
          "rounded-xl border border-dashed p-10 text-center transition-colors",
          "cursor-pointer select-none",
          isDragActive
            ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
            : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700",
          busy ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
        aria-label="Document upload dropzone"
      >
        <input {...getInputProps()} aria-label="Document file input" />
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {isDragActive
            ? "Drop the file to upload"
            : "Drop PDFs, DOCX, or TXT files here"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          or click to browse · up to 25 MB · one file at a time
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          disabled={busy}
        >
          Choose file…
        </Button>
        {stageLabel ? (
          // WHY: aria-live="polite" + role="status" so screen readers
          // announce stage transitions (uploading → registering → processing)
          // without interrupting the user.
          <span
            className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
            aria-live="polite"
            role="status"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            {stageLabel}
          </span>
        ) : null}
      </div>

      {stage === "error" && errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <p className="font-medium">Upload failed</p>
          <p className="mt-1 break-words">{errorMessage}</p>
          <div className="mt-2">
            <Button variant="outline" size="xs" onClick={retry}>
              Dismiss & retry
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

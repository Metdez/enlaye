"use client";

// Compact document upload card for portfolio pages.
// WHY: behavioral contract preserved from [legacy document-upload](../document-upload.tsx) —
// same Storage-first, row-insert-second ordering so the embed trigger finds
// the object in place. Visual layer rebuilt: smaller dashed card, inline
// per-file progress list, toasts replace inline success block.

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { FileText, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

// WHY: matches the 25 MB cap on the `documents-bucket` Storage bucket.
const MAX_BYTES = 25 * 1024 * 1024;

// WHY: explicit MIME allowlist — some browsers report odd MIME types for
// .docx; dual-checking against a hardcoded set gives a clear error surface.
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

const ACCEPT_MAP = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
};

type UploadItemStage = "uploading" | "inserting" | "embedding" | "done" | "error";

type UploadItem = {
  id: string;
  filename: string;
  stage: UploadItemStage;
  error?: string;
};

// WHY: segments must survive URL encoding and the bucket's RLS check
// `(storage.foldername(name))[1] = 'portfolios'`. Strip leading dots so
// `.env.pdf` doesn't become an invisible object.
function sanitizeFilename(name: string): string {
  const trimmed = name.replace(/^\.+/, "");
  return trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function makeItemId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// WHY: the Supabase.ai.Session cold-start occasionally returns HTTP 546
// WORKER_RESOURCE_LIMIT when PDF parsing and embedding model load coincide.
// Warm workers handle the same payload in ~1s, so 3 attempts with
// exponential backoff absorbs the cold-start without user-facing failure.
// Returns null on success, an error message string on exhausted retries.
// deno-lint-ignore no-explicit-any
async function invokeEmbedWithRetry(
  supabase: ReturnType<typeof createBrowserSupabase>,
  record: Record<string, unknown>,
): Promise<string | null> {
  const delays = [0, 1500, 3500];
  let lastError = "unknown error";
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    const { error } = await supabase.functions.invoke("embed", {
      body: { record },
    });
    if (!error) return null;
    lastError = error.message;
  }
  return lastError;
}

export function DocumentUpload({ portfolio_id }: { portfolio_id: string }) {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  // WHY: re-entrancy guard — react-dropzone can double-fire in rare drag
  // sequences, and we don't want two Storage writes racing for the same path.
  const inFlight = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  }, []);

  const runUpload = useCallback(
    async (file: File) => {
      const id = makeItemId();
      setItems((prev) => [
        ...prev,
        { id, filename: file.name, stage: "uploading" },
      ]);

      try {
        if (
          !ACCEPTED_MIME_TYPES.includes(
            file.type as (typeof ACCEPTED_MIME_TYPES)[number],
          )
        ) {
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

        // SECURITY: `documents-bucket` is private; anon inserts are scoped
        // to the `portfolios/` prefix via RLS. See migration
        // 20260420000000_documents_rag_pipeline.sql.
        //
        // WHY the timestamp prefix: collisions on the same filename in the
        // same portfolio would otherwise fail loudly (`upsert: false`); the
        // timestamp makes real collisions astronomically unlikely.
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

        // Insert the documents row, then invoke the embed Edge Function
        // from the client as a belt-and-suspenders.
        // WHY: the DB-side AFTER INSERT trigger `documents_embed_trigger`
        // still exists (and will fire the webhook when pg_net is healthy),
        // but we've seen pg_net OOM on the cloud and swallow dispatches.
        // A client-side invoke guarantees embedding starts regardless of
        // pg_net state. The embed function is idempotent on re-invocation
        // for an already-completed row (it will fast-fail on the status
        // check), so calling it twice is harmless.
        updateItem(id, { stage: "inserting" });
        const { data: insertedRow, error: insertErr } = await supabase
          .from("documents")
          .insert({
            portfolio_id,
            filename: file.name,
            storage_path: storagePath,
            embedding_status: "pending",
          })
          .select()
          .single();
        if (insertErr || !insertedRow) {
          throw new Error(
            `Failed to register document: ${insertErr?.message ?? "no row returned"}`,
          );
        }

        // Await the embed dispatch. WHY not fire-and-forget: if the user
        // navigates away (e.g. jumps straight to /ask) the in-flight
        // invoke can be cancelled by the browser and the row stays in
        // `pending` forever. Awaiting is ~5s but guarantees the function
        // actually runs. On success the function has already flipped
        // `embedding_status` to `complete`, so `router.refresh()` below
        // pulls the updated row immediately.
        // WHY retry: cold starts on the embed Edge Function can hit
        // WORKER_RESOURCE_LIMIT (PDF parsing + loading gte-small model
        // weights briefly exceed the worker's memory ceiling). Subsequent
        // invocations reuse a warm worker and succeed. Three attempts
        // with exponential backoff absorbs this without surfacing an
        // error the user would have to manually retry.
        updateItem(id, { stage: "embedding" });
        const embedErr = await invokeEmbedWithRetry(supabase, insertedRow);
        if (embedErr) {
          throw new Error(
            `Embedding failed: ${embedErr}. The file is uploaded; retry from the Documents list.`,
          );
        }

        updateItem(id, { stage: "done" });
        toastSuccess(`Uploaded ${file.name}`, {
          description: "Ready for chat.",
        });
        router.refresh();

        // Auto-dismiss the completed row after a short window so the list
        // doesn't accumulate between uploads.
        window.setTimeout(() => {
          setItems((prev) => prev.filter((it) => it.id !== id));
        }, 2500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateItem(id, { stage: "error", error: msg });
        toastError(`Upload failed: ${file.name}`, { description: msg });
      }
    },
    [portfolio_id, router, updateItem],
  );

  const onDrop = useCallback(
    async (accepted: File[], rejections: FileRejection[]) => {
      for (const r of rejections) {
        const first = r.errors[0];
        const msg = first?.message ?? "File could not be accepted.";
        toastError(`Rejected: ${r.file.name}`, { description: msg });
      }
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        // Sequentially so two uploads don't collide on the inFlight guard;
        // the UI still shows a per-file row as each starts.
        for (const file of accepted) {
          await runUpload(file);
        }
      } finally {
        inFlight.current = false;
      }
    },
    [runUpload],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: true,
    maxSize: MAX_BYTES,
    accept: ACCEPT_MAP,
    noClick: false,
    noKeyboard: false,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "rounded-lg border border-dashed bg-muted/30 px-5 py-8 text-center transition-colors",
          "cursor-pointer select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-foreground/30",
        )}
        aria-label="Document upload dropzone"
      >
        <input {...getInputProps()} aria-label="Document file input" />
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Upload className="size-4" aria-hidden />
          </div>
          <p className="text-body font-medium text-foreground">
            {isDragActive
              ? "Drop files to upload"
              : "Drop PDFs, DOCX, or TXT files"}
          </p>
          <p className="text-meta">Up to 25 MB each.</p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
          >
            Choose files…
          </Button>
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Upload progress">
          {items.map((it) => (
            <li
              key={it.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-body",
                it.stage === "error" && "border-destructive/40 bg-destructive/5",
              )}
            >
              <FileText
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate" title={it.filename}>
                {it.filename}
              </span>
              {it.stage === "uploading" && (
                <span className="inline-flex items-center gap-1.5 text-meta">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Uploading
                </span>
              )}
              {it.stage === "inserting" && (
                <span className="inline-flex items-center gap-1.5 text-meta">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Registering
                </span>
              )}
              {it.stage === "embedding" && (
                <span className="inline-flex items-center gap-1.5 text-meta">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Embedding
                </span>
              )}
              {it.stage === "done" && (
                <span className="text-meta text-success">Queued</span>
              )}
              {it.stage === "error" && (
                <span className="truncate text-meta text-destructive" title={it.error}>
                  {it.error ?? "Failed"}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

"use client";

// Linear-clean CSV upload card.
// WHY: behavioral contract preserved verbatim from [legacy csv-upload](../csv-upload.tsx) —
// same three-step Postgres → Storage → /api/ml/ingest sequence, same validation,
// same error extraction. Only the visual layer changes: zinc neutrals, single
// blue primary, dashed hairline border, toasts replace inline success banner.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Loader2, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

// WHY: matches the 10 MB cap on the `portfolios-uploads` bucket; enforcing
// client-side too gives fast feedback without a round-trip.
const MAX_BYTES = 10 * 1024 * 1024;

type Stage =
  | "idle"
  | "creating"
  | "uploading"
  | "ingesting"
  | "analyzing"
  | "indexing"
  | "error";

// WHY: the Python service raises HTTPException(detail=...); FastAPI serializes
// as `{ "detail": ... }` which our /api/ml proxy passes through unchanged.
type IngestErrorDetail = { error?: string; details?: string } | string;
type IngestErrorBody = { detail?: IngestErrorDetail };

function extractIngestError(body: IngestErrorBody): string | null {
  const d = body.detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object") return d.error ?? d.details ?? null;
  return null;
}

function describeRejection(rejection: FileRejection): string {
  const first = rejection.errors[0];
  if (!first) return "File could not be accepted.";
  switch (first.code) {
    case "file-too-large":
      return `File is ${(rejection.file.size / 1024 / 1024).toFixed(1)} MB; max is 10 MB.`;
    case "file-invalid-type":
      return "Only .csv files are accepted.";
    case "too-many-files":
      return "Drop one file at a time.";
    default:
      return first.message || "File could not be accepted.";
  }
}

function describeError(err: unknown): string {
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return "Network error — could not reach the server.";
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

const STAGE_LABELS: Record<Exclude<Stage, "idle" | "error">, string> = {
  creating: "Creating portfolio…",
  uploading: "Uploading CSV…",
  ingesting: "Cleaning & ingesting…",
  analyzing: "Analyzing risk…",
  indexing: "Indexing for chat…",
};

export function CsvUpload() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // WHY: re-entrancy guard against double-clicks on the demo button during
  // the creating→uploading gap; would otherwise insert two portfolios.
  const inFlight = useRef(false);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const statusId = useId();
  const fileInputId = useId();

  const runUpload = useCallback(
    async (file: File) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setErrorMessage(null);

      try {
        if (file.size > MAX_BYTES) {
          throw new Error(
            `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is 10 MB.`,
          );
        }

        const supabase = createBrowserSupabase();

        // 1. Create portfolio row.
        setStage("creating");
        const portfolioName = `${file.name} — ${new Date().toISOString()}`;
        const { data: portfolioRow, error: insertErr } = await supabase
          .from("portfolios")
          .insert({ name: portfolioName })
          .select("id")
          .single();

        if (insertErr || !portfolioRow) {
          throw new Error(insertErr?.message ?? "Failed to create portfolio row");
        }
        const portfolioId = portfolioRow.id as string;

        // 2. Upload the raw CSV to Storage.
        setStage("uploading");
        const storagePath = `portfolios/${portfolioId}/raw.csv`;
        const { error: uploadErr } = await supabase.storage
          .from("portfolios-uploads")
          .upload(storagePath, file, {
            contentType: "text/csv",
            upsert: false,
          });
        if (uploadErr) {
          throw new Error(`Storage upload failed: ${uploadErr.message}`);
        }

        // 3. Trigger ingest through the server-side proxy.
        setStage("ingesting");
        const res = await fetch("/api/ml/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            portfolio_id: portfolioId,
            storage_path: storagePath,
          }),
        });

        if (!res.ok) {
          let body: IngestErrorBody = {};
          try {
            body = (await res.json()) as IngestErrorBody;
          } catch {
            // non-JSON error body
          }
          const detail =
            extractIngestError(body) ?? res.statusText ?? `HTTP ${res.status}`;
          throw new Error(`Ingest failed: ${detail}`);
        }

        // 4. Kick off risk analysis so scores are populated before the user
        // lands on the Overview. We await (not fire-and-forget) so the top-5
        // risk module renders populated. If analyze fails, we log and proceed
        // — ingest already succeeded and the user can retry from the page.
        setStage("analyzing");
        try {
          const analyzeRes = await fetch("/api/ml/analyze", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ portfolio_id: portfolioId }),
          });
          if (!analyzeRes.ok) {
            // WHY: don't throw — ingest succeeded. Log so we notice in dev and
            // let the empty-state "Compute risk scores" CTA recover the UX.
            console.warn(
              `Risk analyze returned ${analyzeRes.status}; scores may be missing on landing.`,
            );
          }
        } catch (analyzeErr) {
          console.warn("Risk analyze request failed:", analyzeErr);
        }

        // 5. Index the CSV itself so the Ask chat can answer questions about
        // the rows the user just uploaded — no separate doc upload required.
        // WHY: we copy the same bytes into `documents-bucket` with a `.txt`
        // extension so the existing `embed` Edge Function treats it as plain
        // text (its CSV path is identical to its TXT path — UTF-8 decode +
        // chunk). Non-fatal: if indexing fails we still open the portfolio.
        setStage("indexing");
        try {
          const docFilename = `${file.name}.txt`;
          const docStoragePath = `portfolios/${portfolioId}/docs/${Date.now()}-${docFilename}`;
          const { error: docUploadErr } = await supabase.storage
            .from("documents-bucket")
            .upload(docStoragePath, file, {
              contentType: "text/plain",
              upsert: false,
            });
          if (docUploadErr) {
            throw new Error(`Storage upload failed: ${docUploadErr.message}`);
          }
          const { data: docRow, error: docInsertErr } = await supabase
            .from("documents")
            .insert({
              portfolio_id: portfolioId,
              filename: docFilename,
              storage_path: docStoragePath,
              embedding_status: "pending",
            })
            .select()
            .single();
          if (docInsertErr || !docRow) {
            throw new Error(
              `Failed to register CSV document: ${docInsertErr?.message ?? "no row returned"}`,
            );
          }
          // WHY: await the embed invoke so chat is ready on arrival. If we
          // fire-and-forget, users hit /ask before `embedding_status` flips
          // to `complete` and see the "chat unavailable" empty state. A few
          // extra seconds here is preferable to a broken landing experience.
          const { error: invokeErr } = await supabase.functions.invoke(
            "embed",
            { body: { record: docRow } },
          );
          if (invokeErr) {
            throw new Error(`embed invoke failed: ${invokeErr.message}`);
          }
        } catch (indexErr) {
          console.warn("CSV chat-indexing failed:", indexErr);
        }

        toastSuccess("Portfolio uploaded", {
          description: "Opening portfolio…",
        });
        setStage("idle");
        router.push(`/portfolios/${portfolioId}`);
      } catch (err) {
        const msg = describeError(err);
        setStage("error");
        setErrorMessage(msg);
        toastError("Upload failed", { description: msg });
      } finally {
        inFlight.current = false;
      }
    },
    [router],
  );

  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        const msg = describeRejection(rejections[0]);
        setStage("error");
        setErrorMessage(msg);
        toastError("Upload failed", { description: msg });
        return;
      }
      const file = accepted[0];
      if (!file) return;
      void runUpload(file);
    },
    [runUpload],
  );

  const busy =
    stage === "creating" ||
    stage === "uploading" ||
    stage === "ingesting" ||
    stage === "analyzing" ||
    stage === "indexing";

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    maxFiles: 1,
    maxSize: MAX_BYTES,
    accept: { "text/csv": [".csv"] },
    noClick: false,
    noKeyboard: false,
    disabled: busy,
  });

  const loadDemo = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStage("creating");
    setErrorMessage(null);
    try {
      const res = await fetch("/demo/projects.csv", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Could not load demo CSV (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const file = new File([blob], "projects.csv", { type: "text/csv" });
      inFlight.current = false;
      await runUpload(file);
    } catch (err) {
      const msg = describeError(err);
      setStage("error");
      setErrorMessage(msg);
      toastError("Upload failed", { description: msg });
      inFlight.current = false;
    }
  }, [runUpload]);

  const onFallbackChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > MAX_BYTES) {
        const msg = `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is 10 MB.`;
        setStage("error");
        setErrorMessage(msg);
        toastError("Upload failed", { description: msg });
        return;
      }
      void runUpload(file);
    },
    [runUpload],
  );

  // WCAG 2.4.3 — after error, move focus to retry button so assistive tech
  // announces the actionable next step.
  useEffect(() => {
    if (stage === "error" && retryButtonRef.current) {
      retryButtonRef.current.focus();
    }
  }, [stage]);

  const stageLabel = busy
    ? STAGE_LABELS[stage as Exclude<Stage, "idle" | "error">]
    : null;

  const retry = () => {
    setStage("idle");
    setErrorMessage(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
        {/* PRIMARY: load sample data. Same neutral card shell as the dropzone
            so the visual language stays consistent — only the copy and the
            click target change. */}
        <button
          type="button"
          onClick={() => void loadDemo()}
          disabled={busy}
          className={cn(
            "group flex-1 rounded-lg border bg-muted/30 px-6 py-10 text-center transition-colors",
            "cursor-pointer select-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "border-border hover:border-primary/50 hover:bg-primary/[0.04]",
            busy && "pointer-events-none opacity-60",
          )}
          aria-describedby={busy ? statusId : undefined}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              {busy ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-5" aria-hidden />
              )}
            </div>
            <p className="text-h3 text-foreground">Load sample data</p>
            <p className="text-meta max-w-md">
              15 construction projects, pre-cleaned and flagged. Opens the full
              dashboard in one click.
            </p>
            {stageLabel ? (
              <p className="text-meta mt-1 text-foreground">{stageLabel}</p>
            ) : null}
          </div>
        </button>

        {/* SECONDARY: bring your own CSV. Compact dropzone + file fallback in
            a narrow right column. Drag-and-drop still lives here so users who
            prefer uploading their own data have the full affordance. */}
        <div className="flex shrink-0 flex-col gap-2 md:w-56">
          <div
            {...getRootProps()}
            className={cn(
              "flex flex-1 cursor-pointer select-none flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isDragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:border-foreground/30",
              stage === "error" && "border-destructive/60 bg-destructive/5",
              busy && "pointer-events-none opacity-60",
            )}
            aria-label="CSV upload dropzone"
            aria-busy={busy}
          >
            <input {...getInputProps()} aria-label="CSV file input" />
            <Upload className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-meta font-medium text-foreground">
              {isDragActive ? "Drop to upload" : "Or upload your own CSV"}
            </p>
            <p className="text-meta leading-tight">≤ 10 MB</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              if (fallbackInputRef.current) fallbackInputRef.current.click();
              else open();
            }}
            disabled={busy}
          >
            Choose file…
          </Button>
          <label htmlFor={fileInputId} className="sr-only">
            Choose a CSV file to upload
          </label>
          <input
            ref={fallbackInputRef}
            id={fileInputId}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={onFallbackChange}
            disabled={busy}
          />
        </div>
      </div>

      {/* aria-live region — screen readers get stage transitions. */}
      <div
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {stageLabel ?? ""}
      </div>

      {stage === "error" && errorMessage ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-body text-destructive"
        >
          <div>
            <p className="font-medium">Upload failed</p>
            <p className="mt-0.5 break-words">{errorMessage}</p>
          </div>
          <Button
            ref={retryButtonRef}
            type="button"
            variant="outline"
            size="xs"
            onClick={retry}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}

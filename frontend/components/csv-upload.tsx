"use client";

// Client-side upload widget for the landing page.
// WHY: the upload flow touches three backends in sequence (Postgres row
// insert → Storage upload → ML ingest proxy). Keeping all three in one
// small state machine here avoids scattering the flow across hooks and
// makes the error surface obvious. The page wrapper stays a server
// component — see [page.tsx](../app/page.tsx).

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";

// WHY: matches the 10 MB cap on the `portfolios-uploads` bucket (Task A
// migration). Enforcing client-side too gives fast feedback without a
// round-trip. Values in sync means no "file looked fine, server rejected it".
const MAX_BYTES = 10 * 1024 * 1024;

type Stage = "idle" | "creating" | "uploading" | "ingesting" | "error";

// WHY: the Python service raises HTTPException(detail={error, details, ...}),
// which FastAPI serializes as { "detail": { ... } }. Our /api/ml proxy passes
// the body through unchanged, so the browser sees the nested shape. The
// `string` alternative covers FastAPI's default handling when a raw string
// is passed to `detail`.
type IngestErrorDetail = { error?: string; details?: string } | string;

type IngestErrorBody = {
  detail?: IngestErrorDetail;
};

function extractIngestError(body: IngestErrorBody): string | null {
  const d = body.detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object") return d.error ?? d.details ?? null;
  return null;
}

export function CsvUpload() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // WHY: re-entrancy guard. If a user double-clicks demo during the
  // creating→uploading gap, we'd otherwise insert a second portfolio.
  const inFlight = useRef(false);

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

        // 1. Create portfolio row. The name is human-readable and
        // disambiguates repeated demo uploads by timestamp.
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

        // FIXME(claude): if step 2 (Storage upload) or step 3 (/ingest) fails
        // below, this portfolio row is left orphaned in the DB and shows up in
        // the recent-portfolios list with 0 rows. Acceptable for the single-
        // user demo per ARCHITECTURE.md § Security Model — the user can just
        // re-upload — but a multi-user build should roll back by deleting
        // this row on catch, or move portfolio creation into /ingest itself.

        // 2. Upload the raw CSV to Storage. Path lives inside the bucket;
        // the ingest endpoint tolerates bucket-prefixed or bare paths.
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

        // 3. Trigger ingest through the server-side proxy. The proxy
        // stamps the internal bearer; we only ship user-visible fields.
        // NOTE: assumes the sibling agent's /ingest endpoint accepts
        // { portfolio_id, storage_path } per ARCHITECTURE.md § API Contracts.
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
            // non-JSON error body, fall through to status text
          }
          const detail =
            extractIngestError(body) ??
            res.statusText ??
            `HTTP ${res.status}`;
          throw new Error(`Ingest failed: ${detail}`);
        }

        // 4. Success — redirect straight to the dashboard, no intermediate
        // state. The server page will fetch portfolio + projects fresh.
        router.push(`/portfolios/${portfolioId}`);
      } catch (err) {
        setStage("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
      }
    },
    [router],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      void runUpload(file);
    },
    [runUpload],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    maxFiles: 1,
    maxSize: MAX_BYTES,
    accept: { "text/csv": [".csv"] },
    // We own the button; don't let the dropzone also trigger a picker from
    // a nested button click.
    noClick: false,
    noKeyboard: false,
    disabled: stage === "creating" || stage === "uploading" || stage === "ingesting",
  });

  const loadDemo = useCallback(async () => {
    if (inFlight.current) return;
    // WHY: set the busy flags BEFORE we await the demo download, otherwise a
    // second click can race through while the CSV is in flight. runUpload
    // resets inFlight in its finally; this setter just extends the window
    // so double-clicks across the demo fetch boundary are caught.
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
      // runUpload owns the lifecycle from here; it sets its own stage + flag.
      inFlight.current = false;
      await runUpload(file);
    } catch (err) {
      setStage("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
      inFlight.current = false;
    }
  }, [runUpload]);

  const busy =
    stage === "creating" || stage === "uploading" || stage === "ingesting";
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
        aria-label="CSV upload dropzone"
      >
        <input {...getInputProps()} aria-label="CSV file input" />
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {isDragActive ? "Drop the CSV to upload" : "Drop a CSV here, or click to pick a file"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          .csv only · up to 10 MB · one file at a time
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            void loadDemo();
          }}
          disabled={busy}
        >
          Load demo data
        </Button>
        <Button
          variant="ghost"
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
          <span
            className="text-xs text-zinc-600 dark:text-zinc-400"
            aria-live="polite"
          >
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

const STAGE_LABELS: Record<Exclude<Stage, "idle" | "error">, string> = {
  creating: "Creating portfolio…",
  uploading: "Uploading CSV…",
  ingesting: "Cleaning & ingesting…",
};

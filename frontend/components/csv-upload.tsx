"use client";

// Client-side upload widget for the landing page.
// WHY: the upload flow touches three backends in sequence (Postgres row
// insert → Storage upload → ML ingest proxy). Keeping all three in one
// small state machine here avoids scattering the flow across hooks and
// makes the error surface obvious. The page wrapper stays a server
// component — see [page.tsx](../app/page.tsx).

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDropzone, type FileRejection } from "react-dropzone";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";

// WHY: matches the 10 MB cap on the `portfolios-uploads` bucket (Task A
// migration). Enforcing client-side too gives fast feedback without a
// round-trip. Values in sync means no "file looked fine, server rejected it".
const MAX_BYTES = 10 * 1024 * 1024;

type Stage = "idle" | "creating" | "uploading" | "ingesting" | "success" | "error";

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

// WHY: react-dropzone reports rejections by error code. We translate them to
// human-readable copy here so the alert never leaks "[object Object]" or a
// raw enum like "file-too-large" into the UI.
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

// WHY: surface as much specificity as we can without leaking internals.
// Network failures throw TypeError("Failed to fetch"); we rephrase that for
// non-developer users.
function describeError(err: unknown): string {
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return "Network error — could not reach the server. Check your connection and try again.";
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function CsvUpload() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successPortfolioId, setSuccessPortfolioId] = useState<string | null>(null);
  // WHY: re-entrancy guard. If a user double-clicks demo during the
  // creating→uploading gap, we'd otherwise insert a second portfolio.
  const inFlight = useRef(false);
  // Focus targets — moved to after success / after error per WCAG 2.4.3.
  const successLinkRef = useRef<HTMLAnchorElement | null>(null);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const statusId = useId();
  const errorId = useId();
  const fileInputId = useId();

  const runUpload = useCallback(
    async (file: File) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setErrorMessage(null);
      setSuccessPortfolioId(null);

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

        // 4. Success — show a "view portfolio" link and move keyboard
        // focus to it (WCAG 2.4.3). We still navigate automatically, but
        // the explicit link gives the user a focusable target if their
        // browser delays the route transition.
        setStage("success");
        setSuccessPortfolioId(portfolioId);
        router.push(`/portfolios/${portfolioId}`);
      } catch (err) {
        setStage("error");
        setErrorMessage(describeError(err));
      } finally {
        inFlight.current = false;
      }
    },
    [router],
  );

  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        setStage("error");
        setErrorMessage(describeRejection(rejections[0]));
        return;
      }
      const file = accepted[0];
      if (!file) return;
      void runUpload(file);
    },
    [runUpload],
  );

  const busy =
    stage === "creating" || stage === "uploading" || stage === "ingesting";

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
    disabled: busy,
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
    setSuccessPortfolioId(null);
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
      setErrorMessage(describeError(err));
      inFlight.current = false;
    }
  }, [runUpload]);

  // WHY: handle the keyboard-accessible fallback file input. The dropzone's
  // hidden <input> is only reachable via mouse; this visible <input
  // type="file"> + <label> pair guarantees a tab-and-enter path that does
  // not depend on react-dropzone's keyboard handling.
  const onFallbackChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so picking the same file twice still fires onChange.
      e.target.value = "";
      if (!file) return;
      if (file.size > MAX_BYTES) {
        setStage("error");
        setErrorMessage(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is 10 MB.`,
        );
        return;
      }
      void runUpload(file);
    },
    [runUpload],
  );

  // Focus management per task spec. After success → move focus to the
  // "view portfolio" link. After error → move focus to the retry button so
  // a screen reader announces the actionable next step.
  useEffect(() => {
    if (stage === "success" && successLinkRef.current) {
      successLinkRef.current.focus();
    } else if (stage === "error" && retryButtonRef.current) {
      retryButtonRef.current.focus();
    }
  }, [stage]);

  const stageLabel = busy
    ? STAGE_LABELS[stage as Exclude<Stage, "idle" | "error" | "success">]
    : stage === "success"
      ? "Upload complete. Opening portfolio…"
      : null;

  const retry = () => {
    setStage("idle");
    setErrorMessage(null);
    setSuccessPortfolioId(null);
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={[
          "rounded-xl border border-dashed p-10 text-center transition-colors",
          "cursor-pointer select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isDragActive
            ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
            : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700",
          busy ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
        aria-label="CSV upload dropzone"
        aria-busy={busy}
        aria-describedby={busy ? statusId : undefined}
      >
        <input {...getInputProps()} aria-label="CSV file input (drag-drop)" />
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {isDragActive ? "Drop the CSV to upload" : "Drop a CSV here, or click to pick a file"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          .csv only · up to 10 MB · one file at a time
        </p>
        {busy ? (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Spinner />
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {stageLabel}
            </span>
          </div>
        ) : null}
      </div>

      {/* WHY: keyboard-accessible fallback. The hidden file input below is
          paired with a visible <label> so tab-and-enter works without
          relying on react-dropzone's root-element keyboard handler. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
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
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            // Prefer the visible fallback input for keyboard users; fall
            // back to react-dropzone's `open()` if the ref isn't mounted.
            if (fallbackInputRef.current) {
              fallbackInputRef.current.click();
            } else {
              open();
            }
          }}
          disabled={busy}
        >
          Choose file…
        </Button>
        <label
          htmlFor={fileInputId}
          className="sr-only"
        >
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

      {/* aria-live region — single source of truth for status changes. */}
      <div
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {stageLabel ?? ""}
      </div>

      {stage === "success" && successPortfolioId ? (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          <p className="font-medium">Upload complete.</p>
          <p className="mt-1">
            <Link
              ref={successLinkRef}
              href={`/portfolios/${successPortfolioId}`}
              className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              Open portfolio →
            </Link>
          </p>
        </div>
      ) : null}

      {stage === "error" && errorMessage ? (
        <div
          id={errorId}
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <p className="font-medium">Upload failed</p>
          <p className="mt-1 break-words">{errorMessage}</p>
          <div className="mt-2">
            <Button
              ref={retryButtonRef}
              type="button"
              variant="outline"
              size="xs"
              onClick={retry}
            >
              Dismiss & retry
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const STAGE_LABELS: Record<Exclude<Stage, "idle" | "error" | "success">, string> = {
  creating: "Creating portfolio…",
  uploading: "Uploading CSV…",
  ingesting: "Cleaning & ingesting…",
};

// WHY: tiny inline spinner instead of pulling in an icon library — keeps
// the upload widget self-contained and the bundle small. `motion-reduce`
// honors prefers-reduced-motion per WCAG 2.3.3.
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 motion-reduce:animate-none dark:border-zinc-700 dark:border-t-zinc-200"
    />
  );
}

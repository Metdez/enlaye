"use client";

// Client-side button that kicks off model training for a portfolio.
// WHY: training is the second explicit user action in the dashboard flow
// (upload → train → inspect). Keeping the action here as a small self-
// contained widget means the parent server component can stay pure and
// re-render naturally via `router.refresh()` once the `model_runs` rows
// land. See [csv-upload.tsx](./csv-upload.tsx) for the sibling pattern
// that inspired the error-extraction shape.

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

// WHY: the Python service raises HTTPException(detail=...). FastAPI
// serializes that as `{ "detail": ... }` verbatim, and our /api/ml/train
// proxy passes the body through untouched. The union below covers the
// three known shapes plus a permissive fallback so the narrowing helper
// never throws on unexpected inputs.
type TrainErrorBody =
  | {
      detail: {
        error: "insufficient training data";
        n_completed_projects: number;
        minimum_required: number;
      };
    }
  | { detail: { error: "portfolio not found"; portfolio_id: string } }
  | { detail: string }
  | { [k: string]: unknown };

// NOTE: pulled into a helper (and tested indirectly via the UI) to keep
// the component body focused on state. The narrowing is defensive —
// network errors and stale deploys can surface arbitrary JSON.
function extractTrainError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;

    // FastAPI shape: `{ detail: ... }` — from ml-service/main.py directly.
    if ("detail" in b) {
      const detail = b.detail;

      // 501 stub path: FastAPI passes a bare string through as `detail`.
      if (typeof detail === "string") {
        if (detail.toLowerCase().includes("not implemented")) {
          return "Training not yet implemented.";
        }
        return detail;
      }

      if (detail && typeof detail === "object") {
        const d = detail as Record<string, unknown>;
        const err = typeof d.error === "string" ? d.error : null;

        if (err === "insufficient training data") {
          const n =
            typeof d.n_completed_projects === "number"
              ? d.n_completed_projects
              : 0;
          const min =
            typeof d.minimum_required === "number" ? d.minimum_required : 5;
          return `Not enough completed projects to train (${n} of ${min} required).`;
        }

        if (err === "portfolio not found") {
          return "Portfolio not found.";
        }
      }
    }

    // Proxy shape: the Next.js /api/ml/[...path] route returns
    // `{ error: "..." }` (optionally with `detail`) for its own failures —
    // bad bearer token, ML service unreachable, JSON parse error. These
    // don't traverse into FastAPI so they don't get the `detail` wrapper.
    if (typeof b.error === "string") {
      const detail = typeof b.detail === "string" ? `: ${b.detail}` : "";
      return `Training failed (${status}): ${b.error}${detail}`;
    }
  }

  return `Training failed: ${status}. Please try again.`;
}

export function TrainModelsButton({
  portfolioId,
  disabled,
}: {
  portfolioId: string;
  disabled?: boolean;
}): ReactElement {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WHY: holds the live AbortController so (a) a parent unmount aborts
  // the in-flight request instead of leaking it, and (b) a second click
  // during loading is a no-op (we check the ref before starting).
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Cancel-on-unmount. The fetch promise still resolves, but `finally`
    // will be short-circuited by the `aborted` check below.
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const onClick = useCallback(async () => {
    // Re-entrancy guard: ignore clicks while already training.
    if (loading || disabled) return;

    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ml/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          // Non-JSON error body (e.g. an HTML 502 from a cold proxy);
          // extractTrainError falls back to the generic status message.
        }
        setError(extractTrainError(body, res.status));
        return;
      }

      // WHY: server components on the portfolio page own the model_runs
      // fetch. router.refresh() re-runs their data loaders without a
      // full client-side navigation, so ModelComparison picks up the
      // new rows in place.
      router.refresh();
    } catch (err) {
      // Abort is the expected unmount path — don't surface it as a bug.
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error
          ? `Training failed: ${err.message}`
          : "Training failed: unknown error. Please try again.",
      );
    } finally {
      // Only clear loading if we're still the live controller. A prior
      // aborted request's finally shouldn't stomp a new one's spinner.
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, [loading, disabled, portfolioId, router]);

  const dismissError = useCallback(() => setError(null), []);

  const isDisabled = loading || Boolean(disabled);

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        aria-busy={loading}
        aria-disabled={isDisabled}
        aria-label={loading ? "Training models, please wait" : "Train models"}
        className="inline-flex items-center gap-2 rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-50 disabled:cursor-not-allowed dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus-visible:ring-offset-zinc-950"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            <span>Training models…</span>
          </>
        ) : (
          <>
            <Sparkles size={16} aria-hidden="true" />
            <span>Train models</span>
          </>
        )}
      </button>

      {error ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300"
        >
          <span className="break-words">{error}</span>
          <button
            type="button"
            onClick={dismissError}
            aria-label="Dismiss training error"
            className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium underline underline-offset-2 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 dark:hover:bg-red-900/40"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

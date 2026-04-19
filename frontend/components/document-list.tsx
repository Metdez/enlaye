// Server-rendered list of documents for a portfolio.
// WHY: this is intentionally a server component — the list is read-only
// and re-renders via router.refresh() from the sibling DocumentUpload
// client component. Keeping it server-side means no client bundle cost
// for what's essentially a formatted dump of DB rows, and no risk of the
// list drifting from the database during the pending → complete flip.
// The embed Edge Function writes the status transitions; we just render
// whatever the server read saw at request time.
//
// WHY the `failed:*` handling: the `embed` function stores failure
// reasons as `embedding_status = 'failed:<reason>'` (see
// supabase/functions/embed/index.ts § markFailed). Treat any prefix of
// "failed" as the failed state so future reason strings render correctly
// without a schema change.

import type { ReactElement } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2 } from "lucide-react";
import type { DocumentRow, EmbeddingStatus } from "@/lib/types";

// WHY: instantiated once at module scope. Mirrors the currency formatter
// pattern in anomaly-list.tsx.
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return dateTimeFormatter.format(d);
}

// WHY: normalize "failed:<reason>" (written by the embed function when it
// catches an error) into the canonical 'failed' state for the pill, while
// preserving the reason for the tooltip.
type NormalizedStatus = {
  status: EmbeddingStatus;
  reason: string | null;
};

function normalizeStatus(raw: string): NormalizedStatus {
  if (raw === "complete") return { status: "complete", reason: null };
  if (raw === "pending") return { status: "pending", reason: null };
  if (raw.startsWith("failed")) {
    const reason = raw.startsWith("failed:") ? raw.slice("failed:".length) : null;
    return { status: "failed", reason: reason && reason.length > 0 ? reason : null };
  }
  // Unknown status — treat as pending so the UI doesn't render a red
  // alert for a harmless schema drift.
  return { status: "pending", reason: null };
}

function StatusPill({
  status,
  reason,
}: {
  status: EmbeddingStatus;
  reason: string | null;
}): ReactElement {
  if (status === "complete") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
        <CheckCircle2 size={12} aria-hidden="true" />
        Indexed
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        title={reason ?? "Embedding failed"}
      >
        <AlertTriangle size={12} aria-hidden="true" />
        Failed
      </span>
    );
  }
  // pending
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
      {/* WHY: animate-spin on Loader2 is the established pattern — see
          train-models-button.tsx. Pure CSS animation, no JS timer. */}
      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
      Embedding
    </span>
  );
}

export function DocumentList({
  documents,
}: {
  documents: DocumentRow[];
}): ReactElement {
  if (documents.length === 0) {
    return (
      <div
        className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800"
        role="status"
      >
        <div className="mb-3 flex justify-center">
          <FileText size={40} className="text-zinc-400" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          No documents yet.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Upload a PDF to start asking questions.
        </p>
      </div>
    );
  }

  // WHY: newest first. The DB default orders by insertion; we sort
  // defensively here because callers might pre-filter or pass a shuffled
  // slice and we don't want the UI order to depend on caller discipline.
  const sorted = [...documents].sort((a, b) => {
    const aTime = new Date(a.uploaded_at).getTime();
    const bTime = new Date(b.uploaded_at).getTime();
    return bTime - aTime;
  });

  return (
    // WHY: <ul> + <li> + tabIndex=0 makes the list keyboard-navigable
    // (Tab moves focus through rows) and gives screen readers a proper
    // list semantic. focus-visible:ring keeps the focus indicator
    // consistent with the rest of the app.
    <ul className="space-y-3" aria-label="Uploaded documents">
      {sorted.map((doc) => {
        const { status, reason } = normalizeStatus(doc.embedding_status);
        return (
          <li
            key={doc.id}
            tabIndex={0}
            className="rounded-lg border border-zinc-200 p-4 outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:border-zinc-800 dark:focus-visible:ring-zinc-100"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <FileText
                    size={16}
                    className="shrink-0 text-zinc-500"
                    aria-hidden="true"
                  />
                  <span
                    className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50"
                    title={doc.filename}
                  >
                    {doc.filename}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 tabular-nums">
                  Uploaded {formatUploadedAt(doc.uploaded_at)}
                  {status === "complete" && doc.chunk_count > 0 ? (
                    <>
                      {" · "}
                      <span>{doc.chunk_count} chunks indexed</span>
                    </>
                  ) : null}
                </div>
                {status === "failed" && reason ? (
                  <p className="text-xs text-red-700 dark:text-red-400 break-words">
                    {reason}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0">
                <StatusPill status={status} reason={reason} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

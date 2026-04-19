"use client";

// Document list for a portfolio — rendered via DataTable, with per-row
// Retry + Delete actions.
//
// WHY client component: DataTable owns search/sort state; row actions
// mutate Supabase + optimistically update local state. `router.refresh()`
// after each action pulls the authoritative rows back from the server.
//
// WHY normalize the `failed:<reason>` prefix here: the embed Edge Function
// stores failure reasons as `embedding_status = 'failed:<reason>'`. Treating
// any `failed` prefix as the failed state means future reason strings render
// correctly without a schema change.

import { useCallback, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, RefreshCcw, Trash2 } from "lucide-react";

import { DataTable, type Column } from "@/components/data/data-table";
import { EmptyState } from "@/components/state/empty-state";
import { StatusDot, type StatusTone } from "@/components/data/status-dot";
import { TabularNumber } from "@/components/data/tabular-number";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { formatDate } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import type { DocumentRow, EmbeddingStatus } from "@/lib/types";

type NormalizedStatus = {
  status: EmbeddingStatus;
  reason: string | null;
};

function normalizeStatus(raw: string): NormalizedStatus {
  if (raw === "complete") return { status: "complete", reason: null };
  if (raw === "pending") return { status: "pending", reason: null };
  if (raw.startsWith("failed")) {
    const reason = raw.startsWith("failed:") ? raw.slice("failed:".length) : null;
    return {
      status: "failed",
      reason: reason && reason.length > 0 ? reason : null,
    };
  }
  // Unknown status — treat as pending so schema drift doesn't render red.
  return { status: "pending", reason: null };
}

const STATUS_TONE: Record<EmbeddingStatus, StatusTone> = {
  complete: "success",
  pending: "warning",
  failed: "danger",
};

const STATUS_LABEL: Record<EmbeddingStatus, string> = {
  complete: "Indexed",
  pending: "Embedding",
  failed: "Failed",
};

function StatusCell({ raw }: { raw: string }): ReactElement {
  const { status, reason } = normalizeStatus(raw);
  const dot = (
    <StatusDot tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
  );
  if (status === "failed" && reason) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="cursor-help">{dot}</span>} />
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );
  }
  return dot;
}

export function DocumentList({
  documents,
}: {
  documents: DocumentRow[];
}): ReactElement {
  const router = useRouter();
  // Optimistic removals — server refresh is authoritative, but we drop the
  // row from the visible list immediately on delete click so the UI feels
  // instant.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  // Per-row in-flight action: "retry" or "delete" (or null).
  const [acting, setActing] = useState<Record<string, "retry" | "delete" | undefined>>({});

  const setAction = useCallback(
    (id: string, action: "retry" | "delete" | undefined) => {
      setActing((prev) => {
        const next = { ...prev };
        if (action === undefined) delete next[id];
        else next[id] = action;
        return next;
      });
    },
    [],
  );

  const handleRetry = useCallback(
    async (row: DocumentRow) => {
      setAction(row.id, "retry");
      try {
        const supabase = createBrowserSupabase();
        // Reset status to pending so the UI tone flips immediately on refresh.
        await supabase
          .from("documents")
          .update({ embedding_status: "pending", chunk_count: 0 })
          .eq("id", row.id);

        const { error } = await supabase.functions.invoke("embed", {
          body: { record: row },
        });
        if (error) throw new Error(error.message);

        toastSuccess(`Re-embedded ${row.filename}`);
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toastError(`Retry failed: ${row.filename}`, { description: msg });
      } finally {
        setAction(row.id, undefined);
      }
    },
    [router, setAction],
  );

  const handleDelete = useCallback(
    async (row: DocumentRow) => {
      // Optimistic: hide immediately; we'll restore on failure.
      setAction(row.id, "delete");
      setRemovedIds((prev) => new Set(prev).add(row.id));

      try {
        const supabase = createBrowserSupabase();

        // Storage delete is best-effort — if the object is already gone
        // (manual cleanup, previous failed delete), keep going.
        const { error: storageErr } = await supabase.storage
          .from("documents-bucket")
          .remove([row.storage_path]);
        if (storageErr) {
          // eslint-disable-next-line no-console
          console.warn("storage delete warning", storageErr.message);
        }

        // FK cascade on document_chunks.document_id → deleting the parent
        // row cleans up chunks automatically. See the initial schema.
        const { error: rowErr } = await supabase
          .from("documents")
          .delete()
          .eq("id", row.id);
        if (rowErr) throw new Error(rowErr.message);

        toastSuccess(`Deleted ${row.filename}`);
        router.refresh();
      } catch (err) {
        // Rollback the optimistic hide.
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
        const msg = err instanceof Error ? err.message : String(err);
        toastError(`Delete failed: ${row.filename}`, { description: msg });
      } finally {
        setAction(row.id, undefined);
      }
    },
    [router, setAction],
  );

  const columns: Column<DocumentRow>[] = [
    {
      key: "filename",
      header: "Filename",
      width: "340px",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <FileText
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate font-medium" title={row.filename}>
            {row.filename}
          </span>
        </div>
      ),
    },
    {
      key: "uploaded_at",
      header: "Uploaded",
      width: "140px",
      nowrap: true,
      cell: (row) => (
        <span className="text-muted-foreground">{formatDate(row.uploaded_at)}</span>
      ),
    },
    {
      key: "chunk_count",
      header: "Chunks",
      align: "right",
      width: "80px",
      nowrap: true,
      cell: (row) => <TabularNumber value={row.chunk_count} />,
    },
    {
      key: "embedding_status",
      header: "Status",
      width: "128px",
      nowrap: true,
      cell: (row) => <StatusCell raw={row.embedding_status} />,
    },
    {
      key: "id",
      header: "",
      width: "136px",
      nowrap: true,
      align: "right",
      cell: (row) => {
        const { status } = normalizeStatus(row.embedding_status);
        const action = acting[row.id];
        const canRetry = status !== "complete";
        return (
          <div className="flex items-center justify-end gap-1">
            {canRetry ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Retry embedding ${row.filename}`}
                      disabled={action !== undefined}
                      onClick={() => void handleRetry(row)}
                    >
                      {action === "retry" ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCcw className="size-3.5" aria-hidden />
                      )}
                    </Button>
                  }
                />
                <TooltipContent>Retry embedding</TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${row.filename}`}
                    disabled={action !== undefined}
                    onClick={() => void handleDelete(row)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    {action === "delete" ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                  </Button>
                }
              />
              <TooltipContent>Delete document</TooltipContent>
            </Tooltip>
          </div>
        );
      },
    },
  ];

  const visible = documents.filter((d) => !removedIds.has(d.id));

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Upload PDFs, DOCX, or TXT to enable the chat."
      />
    );
  }

  // Newest first — defensive sort since callers may pre-filter or shuffle.
  const sorted = [...visible].sort((a, b) => {
    const aTime = new Date(a.uploaded_at).getTime();
    const bTime = new Date(b.uploaded_at).getTime();
    return bTime - aTime;
  });

  return <DataTable columns={columns} rows={sorted} rowKey={(r) => r.id} />;
}

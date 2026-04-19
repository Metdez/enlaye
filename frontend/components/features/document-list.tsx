"use client";

// Document list for a portfolio — rendered via DataTable.
// WHY: client component. `DataTable` is client-side (owns search/sort state),
// and column `cell` renderers are functions that can't cross the RSC boundary.
// The parent page still triggers `router.refresh()` after upload so the list
// picks up the new row on the next server pass.
//
// WHY normalize the `failed:<reason>` prefix here: the embed Edge Function
// stores failure reasons as `embedding_status = 'failed:<reason>'`. Treating
// any `failed` prefix as the failed state means future reason strings render
// correctly without a schema change.

import type { ReactElement } from "react";
import { FileText } from "lucide-react";

import { DataTable, type Column } from "@/components/data/data-table";
import { EmptyState } from "@/components/state/empty-state";
import { StatusDot, type StatusTone } from "@/components/data/status-dot";
import { TabularNumber } from "@/components/data/tabular-number";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format";
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
  // WHY: only wrap in Tooltip when we have a concrete failure reason —
  // adds assistive context that the tone alone can't convey.
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

const columns: Column<DocumentRow>[] = [
  {
    key: "filename",
    header: "Filename",
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
    cell: (row) => (
      <span className="text-muted-foreground">{formatDate(row.uploaded_at)}</span>
    ),
  },
  {
    key: "chunk_count",
    header: "Chunks",
    align: "right",
    cell: (row) => <TabularNumber value={row.chunk_count} />,
  },
  {
    key: "embedding_status",
    header: "Status",
    cell: (row) => <StatusCell raw={row.embedding_status} />,
  },
];

export function DocumentList({
  documents,
}: {
  documents: DocumentRow[];
}): ReactElement {
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Upload PDFs, DOCX, or TXT to enable the chat."
      />
    );
  }

  // Newest first — defensive sort since callers may pre-filter or shuffle.
  const sorted = [...documents].sort((a, b) => {
    const aTime = new Date(a.uploaded_at).getTime();
    const bTime = new Date(b.uploaded_at).getTime();
    return bTime - aTime;
  });

  return <DataTable columns={columns} rows={sorted} />;
}

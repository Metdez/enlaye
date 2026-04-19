// Compact source preview rendered under assistant messages.
// WHY: one card per retrieved chunk — filename + similarity score + a
// three-line preview. Clicking a citation chip scrolls the matching card
// into view and flashes a ring for 1.5s (the ref is attached in
// message-bubble.tsx). Server-renderable — no interactivity of its own.

import type { ReactElement, Ref } from "react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";

export type SourceChunk = {
  chunk_id: string;
  document_filename: string;
  similarity: number;
  preview: string;
};

type SourceCardProps = {
  index: number; // 1-based; mirrors the citation chip label.
  source: SourceChunk;
  cardRef?: Ref<HTMLDivElement>;
  className?: string;
};

/** One retrieved chunk preview, keyed by `[C<index>]` in the assistant text. */
export function SourceCard({
  index,
  source,
  cardRef,
  className,
}: SourceCardProps): ReactElement {
  return (
    <div
      ref={cardRef}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 transition-[box-shadow] duration-150",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-meta">
        <span className="inline-flex items-center rounded-sm bg-sidebar-accent px-1.5 py-0.5 font-mono font-medium text-sidebar-accent-foreground">
          C{index}
        </span>
        <FileText
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span
          className="min-w-0 flex-1 truncate font-medium text-foreground"
          title={source.document_filename}
        >
          {source.document_filename}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {source.similarity.toFixed(2)}
        </span>
      </div>
      <p className="line-clamp-3 text-body text-muted-foreground">
        {source.preview.length > 160
          ? `${source.preview.slice(0, 160).trimEnd()}…`
          : source.preview}
      </p>
    </div>
  );
}

"use client";

// Single chat bubble — user, assistant, or pending (typing skeleton).
// WHY: assistant text is parsed for `[C<n>]` patterns and spliced into
// <CitationChip /> nodes inline. Clicking a chip walks the sibling refs
// the parent message-list has registered and flashes the matching source
// for 1.5s. Pending bubbles render three shimmer lines so the list height
// doesn't jump when the response lands.

import { useRef, type ReactElement } from "react";

import { CitationChip } from "@/components/features/chat/citation-chip";
import {
  ConfidenceDot,
  type Confidence,
} from "@/components/features/chat/confidence-dot";
import {
  SourceCard,
  type SourceChunk,
} from "@/components/features/chat/source-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ChatRole = "user" | "assistant" | "pending";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: SourceChunk[];
  confidence?: Confidence;
  topSimilarity?: number | null;
};

// Tokenized answer: either a literal text slice or a resolved citation index
// (1-based). The JSX layer turns indices into chips with a click handler,
// which keeps the splitter pure and free of any ref capture.
type AnswerToken =
  | { kind: "text"; value: string }
  | { kind: "chip"; index: number };

// WHY: fresh regex per call — the `g` flag carries `lastIndex` between
// invocations on a shared literal, which silently breaks re-renders.
function tokenize(text: string, maxIndex: number): AnswerToken[] {
  const out: AnswerToken[] = [];
  const re = /\[C(\d+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      out.push({ kind: "text", value: text.slice(last, match.index) });
    }
    const n = Number.parseInt(match[1] ?? "0", 10);
    if (n >= 1 && n <= maxIndex) {
      out.push({ kind: "chip", index: n });
    } else {
      // Unknown index — keep the literal so the model's intent is visible.
      out.push({ kind: "text", value: match[0] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

// Ultralight markdown → React. Handles `**bold**`, `*italic*`, and inline
// `code`. Deliberately narrow scope: avoids pulling in a full markdown
// library for one chat surface, and the model's cite-or-abstain prompt
// already prunes most other markdown (tables, images, headings).
function renderInlineMarkdown(text: string, keyPrefix: string): ReactElement[] {
  const out: ReactElement[] = [];
  // Match bold > italic > code in that order so `**foo**` isn't eaten by
  // the italic pattern on the first asterisk.
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      out.push(
        <span key={`${keyPrefix}-t-${i++}`}>
          {text.slice(last, match.index)}
        </span>,
      );
    }
    const bold = match[1];
    const italic = match[2];
    const code = match[3];
    if (bold !== undefined) {
      out.push(
        <strong
          key={`${keyPrefix}-b-${i++}`}
          className="font-semibold text-foreground"
        >
          {bold}
        </strong>,
      );
    } else if (italic !== undefined) {
      out.push(
        <em key={`${keyPrefix}-i-${i++}`} className="italic">
          {italic}
        </em>,
      );
    } else if (code !== undefined) {
      out.push(
        <code
          key={`${keyPrefix}-c-${i++}`}
          className="rounded-sm bg-background/60 px-1 py-px font-mono text-[0.85em] text-foreground"
        >
          {code}
        </code>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push(
      <span key={`${keyPrefix}-t-${i++}`}>{text.slice(last)}</span>,
    );
  }
  return out;
}

type MessageBubbleProps = {
  message: ChatMessage;
};

export function MessageBubble({ message }: MessageBubbleProps): ReactElement {
  // Refs per source card — chip click scrolls + ring-flashes the match.
  const sourceRefs = useRef<Array<HTMLDivElement | null>>([]);

  const sources = message.sources ?? [];
  const tokens =
    message.role === "assistant" ? tokenize(message.content, sources.length) : [];

  if (message.role === "pending") {
    return (
      <div className="flex justify-start" aria-label="Assistant is thinking">
        <div className="flex w-full max-w-[85%] flex-col gap-2 rounded-lg bg-muted px-4 py-3">
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-body text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant.
  return (
    <div className="flex justify-start">
      <div className="flex w-full max-w-[85%] flex-col gap-2">
        <div className="whitespace-pre-wrap break-words rounded-lg bg-muted px-4 py-3 text-[14.5px] leading-[1.65] text-foreground/90">
          {tokens.map((tok, i) =>
            tok.kind === "text" ? (
              <span key={`t-${i}`}>{renderInlineMarkdown(tok.value, `t-${i}`)}</span>
            ) : (
              <CitationChip
                key={`c-${i}-${tok.index}`}
                index={tok.index}
                onClick={(oneBased) => {
                  // WHY: read the ref at event time, not during render —
                  // satisfies react-hooks/refs and matches React's intent.
                  const el = sourceRefs.current[oneBased - 1];
                  if (!el) return;
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("ring-2", "ring-primary");
                  window.setTimeout(() => {
                    el.classList.remove("ring-2", "ring-primary");
                  }, 1500);
                }}
              />
            ),
          )}
        </div>
        {message.confidence ? (
          <ConfidenceDot
            confidence={message.confidence}
            score={message.topSimilarity}
          />
        ) : null}
        {sources.length > 0 ? (
          <ol
            className={cn("mt-1 flex flex-col gap-2 list-none p-0")}
            aria-label="Sources"
          >
            {sources.map((src, i) => (
              <li key={src.chunk_id}>
                <SourceCard
                  index={i + 1}
                  source={src}
                  cardRef={(el) => {
                    sourceRefs.current[i] = el;
                  }}
                />
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

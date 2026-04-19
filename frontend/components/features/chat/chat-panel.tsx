"use client";

// Full-height chat container — message list + composer + retrieval settings.
// WHY: behavioral contract preserved from [legacy chat-interface](../../chat-interface.tsx) —
// direct fetch to the Supabase `query` Edge Function with both `apikey` and
// `Authorization` headers, AbortController lifecycle, citation parsing,
// confidence mapping. Visual layer rebuilt against the design system:
// Linear-clean bubbles, retrieval settings sit in a sidebar at lg+ and
// collapse into a Popover trigger on smaller screens.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Loader2, Send, Settings2, Sparkles } from "lucide-react";

import {
  MessageList,
} from "@/components/features/chat/message-list";
import type { ChatMessage } from "@/components/features/chat/message-bubble";
import type { Confidence } from "@/components/features/chat/confidence-dot";
import type { SourceChunk } from "@/components/features/chat/source-card";
import {
  DEFAULT_RETRIEVAL,
  RetrievalSettings,
  type RetrievalValues,
} from "@/components/features/chat/retrieval-settings";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/state/empty-state";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

// NOTE: fail-loudly — mirrors lib/supabase-browser.ts so a misconfigured
// deploy surfaces the same message regardless of entry point.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Derive frontend/.env.local from the root .env before running.",
  );
}

type QueryResponse = {
  answer: string | null;
  sources: SourceChunk[];
  confidence: Confidence;
};

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type ChatPanelProps = {
  portfolioId: string;
  disabled?: boolean;
  className?: string;
};

export function ChatPanel({
  portfolioId,
  disabled = false,
  className,
}: ChatPanelProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [retrieval, setRetrieval] =
    useState<RetrievalValues>(DEFAULT_RETRIEVAL);

  // WHY: a single controller owns the live fetch; new submits abort the
  // previous, unmount aborts whatever is still pending.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const submit = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || loading || disabled) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        content: question,
      };
      const pendingId = makeId();
      const pendingMsg: ChatMessage = {
        id: pendingId,
        role: "pending",
        content: "",
      };

      setMessages((prev) => [...prev, userMsg, pendingMsg]);
      setInput("");
      setLoading(true);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/query`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // SECURITY: anon key only; service-role stays behind the edge
            // function. See ARCHITECTURE.md § Security Model.
            apikey: SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${SUPABASE_ANON_KEY!}`,
          },
          body: JSON.stringify({
            portfolio_id: portfolioId,
            question,
            top_k: retrieval.topK,
            threshold: retrieval.threshold,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const parsed = (await res.json()) as {
              error?: string;
              message?: string;
            };
            detail = parsed.error ?? parsed.message ?? detail;
          } catch {
            // non-JSON error body
          }
          throw new Error(detail);
        }

        const data = (await res.json()) as QueryResponse;
        const topSimilarity = data.sources.length
          ? Math.max(...data.sources.map((s) => s.similarity))
          : null;

        const assistantMsg: ChatMessage = {
          id: makeId(),
          role: "assistant",
          content:
            data.answer ??
            "No relevant context found above the threshold. Try lowering the threshold or asking a different question.",
          sources: data.sources,
          // WHY: a null answer means nothing cleared the threshold — clamp
          // confidence to low so the UI reads the same as reality.
          confidence: data.answer === null ? "low" : data.confidence,
          topSimilarity,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === pendingId ? assistantMsg : m)),
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        toastError("Query failed", { description: msg });
        // Drop the pending bubble so the thread doesn't strand a skeleton.
        setMessages((prev) => prev.filter((m) => m.id !== pendingId));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    },
    [loading, disabled, portfolioId, retrieval.topK, retrieval.threshold],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // WHY: Cmd/Ctrl+Enter submits — leaves plain Enter free for newlines,
      // which matters for multi-line questions and for IME users whose
      // Enter commits a candidate rather than sending a line.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit(input);
      }
    },
    [input, submit],
  );

  const onSubmitForm = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void submit(input);
    },
    [input, submit],
  );

  if (disabled) {
    return (
      <div className={cn("flex min-h-[420px] items-center", className)}>
        <EmptyState
          icon={Sparkles}
          title="Chat unavailable"
          description="Upload and index a document to enable chat."
          className="w-full"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid h-full min-h-[480px] gap-6",
        "lg:grid-cols-[minmax(0,1fr)_320px]",
        className,
      )}
    >
      {/* Left — message list + composer */}
      <div className="flex min-h-0 flex-col gap-4">
        <MessageList messages={messages} className="min-h-[320px]" />

        <form
          className="flex flex-col gap-2"
          onSubmit={onSubmitForm}
          aria-label="Ask a question"
        >
          <div className="flex items-end gap-2">
            <label htmlFor="chat-composer" className="sr-only">
              Ask a question about your documents
            </label>
            <Textarea
              id="chat-composer"
              name="question"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading}
              rows={2}
              placeholder="Ask about your documents…"
              className="min-h-16 flex-1 resize-y"
            />
            {/* Mobile-only settings trigger — desktop has the sidebar. */}
            <div className="lg:hidden">
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Retrieval settings"
                    >
                      <Settings2 aria-hidden />
                    </Button>
                  }
                />
                <PopoverContent side="top" align="end" className="w-80 p-0">
                  <RetrievalSettings
                    values={retrieval}
                    onChange={setRetrieval}
                    className="border-0 ring-0"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button
              type="submit"
              disabled={loading || input.trim().length === 0}
              aria-label="Send"
            >
              {loading ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Send aria-hidden />
              )}
              Send
            </Button>
          </div>
          <p className="text-meta text-muted-foreground">
            Cmd/Ctrl+Enter to send.
          </p>
        </form>
      </div>

      {/* Right — retrieval settings sidebar (lg+) */}
      <aside className="hidden lg:block">
        <div className="sticky top-4">
          <RetrievalSettings values={retrieval} onChange={setRetrieval} />
        </div>
      </aside>
    </div>
  );
}

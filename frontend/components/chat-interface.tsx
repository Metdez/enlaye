"use client";

// ============================================================================
// Chat Interface — RAG Q&A over uploaded project documents for a portfolio.
// ============================================================================
//
// Responsibilities:
//   1. Keep a per-session message list (user + assistant turns) in local state.
//   2. Let the user tune retrieval (top_k, threshold) via a collapsible panel.
//   3. POST questions directly to the Supabase Edge Function `query` and render
//      the assistant answer with clickable citation chips + an expandable
//      sources list.
//   4. Show a loading ghost message while a request is in flight.
//   5. Cancel any in-flight request on unmount or when a new submit arrives.
//
// WHY this is a client component: we need interactive local state (messages,
// textarea value, retrieval sliders, expanded-source accordion) and direct
// fetch control (AbortController). The parent page remains a server component
// and passes `portfolio_id` as a prop.
//
// WHY no persistence: Phase 5 scope explicitly treats chat as ephemeral — if
// we decide to persist later, a `chat_messages` table keyed on portfolio_id is
// the right cut (user_id, role, content, sources jsonb, created_at).
//
// WHY we call the Edge Function directly (not a Next.js /api proxy): the
// Edge Function is a public HTTP endpoint gated by the Supabase JWT
// (anon key). Proxying through Next would add a hop for no security gain —
// the anon key is already public by design and the browser can't hold
// anything more privileged.
//
// SECURITY: we attach `Authorization: Bearer <NEXT_PUBLIC_SUPABASE_ANON_KEY>`
// and `apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>`. That's the standard Supabase
// Functions auth. The anon key is intentionally browser-visible; the heavy
// privileges (service_role access to documents/chunks, OpenRouter API key)
// stay server-side inside the Edge Function itself. See ARCHITECTURE.md §
// Security Model — Key Hierarchy.
// ============================================================================

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Send,
  Sliders,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types — mirror ARCHITECTURE.md § API Contracts → Supabase Edge Function `query`.
// ---------------------------------------------------------------------------

type Confidence = "high" | "medium" | "low";

type SourceChunk = {
  chunk_id: string;
  document_filename: string;
  similarity: number;
  preview: string;
};

type QueryRequest = {
  portfolio_id: string;
  question: string;
  top_k: number;
  threshold: number;
};

type QueryResponse = {
  answer: string | null;
  sources: SourceChunk[];
  confidence: Confidence;
};

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: SourceChunk[];
  confidence?: Confidence;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Env — same fail-loudly pattern as lib/supabase-browser.ts. We don't import
// the Supabase SDK here because we just need the URL + anon key for a direct
// fetch; pulling in createBrowserClient would be overkill.
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // NOTE: matches the message in lib/supabase-browser.ts so a misconfigured
  // deploy fails the same way everywhere instead of with a mystery fetch error.
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Derive frontend/.env.local from the root .env before running.",
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_TOP_K = 3;
const DEFAULT_THRESHOLD = 0.5;
const MIN_TOP_K = 1;
const MAX_TOP_K = 10;

// WHY: realistic construction-project questions, not generic demos. These are
// the kinds of things an analyst would actually type, so the suggestions
// double as a signal of what the RAG layer is supposed to answer.
const SUGGESTED_QUESTIONS = [
  "What were the main drivers of cost overruns?",
  "Are there safety incident patterns across regions?",
  "Which subcontractors are flagged most often?",
];

// Citation regex — matches [C1], [C12], etc. Used both to split the answer
// text for inline chip rendering and to validate a source index exists.
const CITATION_PATTERN = /\[C(\d+)\]/g;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function makeId(): string {
  // Non-cryptographic, fine for local-only message keys.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function confidenceDotClass(c: Confidence | undefined): string {
  // WHY: gray for low (or unknown) is deliberately muted — we don't want
  // "no context found" to look like a confident answer.
  switch (c) {
    case "high":
      return "bg-emerald-500";
    case "medium":
      return "bg-amber-500";
    default:
      return "bg-zinc-400 dark:bg-zinc-600";
  }
}

function confidenceLabel(c: Confidence | undefined): string {
  switch (c) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
    default:
      return "Unknown confidence";
  }
}

// ---------------------------------------------------------------------------
// Inline answer renderer — turns "foo [C1] bar [C2]" into text + clickable
// citation chips that scroll to the matching source card below.
// ---------------------------------------------------------------------------
function renderAnswerWithCitations(
  text: string,
  sources: SourceChunk[] | undefined,
  onCitationClick: (sourceIndex: number) => void,
): ReactElement {
  if (!sources || sources.length === 0) {
    return <span>{text}</span>;
  }

  const parts: Array<string | { index: number; key: string }> = [];
  let lastIndex = 0;
  // WHY: build a fresh regex each render — regex objects with the `g` flag
  // hold state in `lastIndex` between calls, which would break the second
  // render of the same message.
  const pattern = new RegExp(CITATION_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  let chipCounter = 0;

  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const citationNumber = Number.parseInt(match[1] ?? "0", 10);
    const sourceIdx = citationNumber - 1; // [C1] → sources[0]

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (sourceIdx >= 0 && sourceIdx < sources.length) {
      parts.push({ index: sourceIdx, key: `chip-${chipCounter++}` });
    } else {
      // Citation refers to a chunk we didn't receive — keep the literal so
      // the user can still see the model's intent rather than silently drop it.
      parts.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <span>
      {parts.map((part, i) => {
        if (typeof part === "string") {
          return <span key={`t-${i}`}>{part}</span>;
        }
        const src = sources[part.index];
        return (
          <button
            key={part.key}
            type="button"
            onClick={() => onCitationClick(part.index)}
            className="mx-0.5 inline-flex items-center rounded-md bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
            aria-label={`Jump to source ${part.index + 1}: ${src?.document_filename ?? ""}`}
          >
            C{part.index + 1}
          </button>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Memoized message renderer — splitting this out + wrapping in React.memo
// keeps the (potentially long) message history from re-rendering on every
// keystroke in the textarea. Equality check is shallow; ChatMessage objects
// are created once and never mutated, and the callback props are stable
// (useCallback in the parent), so the cache hit rate is effectively 100%.
// ---------------------------------------------------------------------------
type MessageItemProps = {
  message: ChatMessage;
  expandedSources: Set<string>;
  onCitationJump: (sourceKey: string) => void;
  onToggleSource: (key: string) => void;
};

const MessageItem = memo(function MessageItem({
  message: m,
  expandedSources,
  onCitationJump,
  onToggleSource,
}: MessageItemProps): ReactElement {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-zinc-200 px-3.5 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
          {m.content}
        </div>
      </div>
    );
  }

  // WHY: stable per-message id prefix so multiple assistant turns can't
  // collide on `source-0` etc. when both render expandable cards.
  const sourceKeyFor = (srcIdx: number) => `chat-source-${m.id}-${srcIdx}`;
  const confidenceText = confidenceLabel(m.confidence);

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-3">
        <div className="flex items-start gap-2">
          {/* WHY (a11y): not color-only — the dot is paired with a visible
              text label below the bubble. Screen readers get the same
              text via the bubble's aria-label. */}
          <span
            className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${confidenceDotClass(m.confidence)}`}
            aria-hidden="true"
          />
          <div className="space-y-1">
            <div
              className="rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-3.5 py-2 text-sm leading-relaxed text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              aria-label={`Assistant answer, ${confidenceText.toLowerCase()}`}
            >
              {renderAnswerWithCitations(m.content, m.sources, (srcIdx) =>
                onCitationJump(sourceKeyFor(srcIdx)),
              )}
            </div>
            <p className="px-1 text-[11px] font-medium text-zinc-500">
              {confidenceText}
            </p>
          </div>
        </div>

        {m.sources && m.sources.length > 0 ? (
          <ol className="space-y-2 pl-4">
            {m.sources.map((src, srcIdx) => {
              const key = sourceKeyFor(srcIdx);
              const expanded = expandedSources.has(key);
              return (
                <li
                  key={key}
                  id={key}
                  className="rounded-md border border-zinc-200 bg-white p-2.5 text-xs transition-shadow dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <button
                    type="button"
                    onClick={() => onToggleSource(key)}
                    aria-expanded={expanded}
                    aria-controls={`${key}-preview`}
                    className="flex w-full items-center justify-between gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="mr-1.5 inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        C{srcIdx + 1}
                      </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {src.document_filename}
                      </span>
                      <span className="ml-2 tabular-nums text-zinc-500">
                        similarity {src.similarity.toFixed(2)}
                      </span>
                    </span>
                    {expanded ? (
                      <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-zinc-500" />
                    )}
                  </button>
                  {expanded ? (
                    <p
                      id={`${key}-preview`}
                      className="mt-2 whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-400"
                    >
                      {src.preview}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChatInterface({
  portfolio_id,
  disabled = false,
}: {
  portfolio_id: string;
  disabled?: boolean;
}): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [topK, setTopK] = useState(DEFAULT_TOP_K);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    () => new Set(),
  );

  // WHY: one AbortController owns the in-flight fetch. On new submit we abort
  // the previous, and on unmount we abort whatever's pending to avoid a
  // setState-after-unmount warning.
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Autoscroll to the latest message whenever the list grows or loading flips.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const hasMessages = messages.length > 0;

  const submit = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || loading) return;

      // Cancel any previous request so we don't race two in parallel.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        content: question,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setErrorMessage(null);
      setLoading(true);

      try {
        const body: QueryRequest = {
          portfolio_id,
          question,
          top_k: topK,
          threshold,
        };

        const res = await fetch(`${SUPABASE_URL}/functions/v1/query`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // SECURITY: Supabase Functions require both headers. `apikey` is
            // the project-level gate; `Authorization` carries the JWT that
            // (in a multi-user build) identifies the caller. In demo mode
            // both are the anon key — still safe, see file header.
            apikey: SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${SUPABASE_ANON_KEY!}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const parsed = (await res.json()) as { error?: string; message?: string };
            detail = parsed.error ?? parsed.message ?? detail;
          } catch {
            // non-JSON body; fall through with status code
          }
          throw new Error(detail);
        }

        const data = (await res.json()) as QueryResponse;

        const assistantMsg: ChatMessage = {
          id: makeId(),
          role: "assistant",
          // WHY: when `answer === null`, the server tells us nothing passed
          // the threshold. Render a helpful fallback message instead of a
          // blank bubble so the user knows to lower the threshold.
          content:
            data.answer ??
            "No relevant context found above the threshold. Try lowering the threshold or asking a different question.",
          sources: data.sources,
          // If the server returned null, force low confidence regardless of
          // what the `confidence` field says — the UI should match reality.
          confidence: data.answer === null ? "low" : data.confidence,
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        // AbortError is expected when the user fires a second question or
        // unmounts; don't surface it as an error.
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
      } finally {
        // Only clear loading if this controller is still the live one (a
        // faster second submit may have replaced it).
        if (abortRef.current === controller) {
          setLoading(false);
          abortRef.current = null;
        }
      }
    },
    [loading, portfolio_id, topK, threshold],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // WHY: Enter submits, Shift+Enter inserts a newline. This matches the
      // dominant chat-app convention (ChatGPT, Slack, Linear) and is what
      // a fresh user expects. Cmd/Ctrl+Enter still submits as a power-user
      // alias.
      if (e.key === "Enter" && !e.shiftKey) {
        // IME composition (e.g. Japanese / Chinese input) emits Enter to
        // commit a candidate — don't hijack that as submit.
        if (e.nativeEvent.isComposing) return;
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

  const scrollToSource = useCallback((globalSourceKey: string) => {
    const el = document.getElementById(globalSourceKey);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Briefly flash the card so the jump is visually obvious.
    el.classList.add("ring-2", "ring-blue-400");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-blue-400");
    }, 1200);
  }, []);

  const toggleSourceExpanded = useCallback((key: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const suggestionButtons = useMemo(
    () =>
      SUGGESTED_QUESTIONS.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => setInput(q)}
          className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
        >
          {q}
        </button>
      )),
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Retrieval settings — collapsible, above the input */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-expanded={settingsOpen}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <span className="inline-flex items-center gap-2">
            <Sliders className="size-4" />
            Retrieval settings
          </span>
          {settingsOpen ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>

        {settingsOpen ? (
          <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <label htmlFor="chat-top-k">top_k</label>
                <span className="tabular-nums text-zinc-900 dark:text-zinc-50">
                  {topK}
                </span>
              </div>
              <input
                id="chat-top-k"
                type="range"
                min={MIN_TOP_K}
                max={MAX_TOP_K}
                step={1}
                value={topK}
                onChange={(e) => setTopK(Number.parseInt(e.target.value, 10))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-zinc-900 dark:bg-zinc-800 dark:accent-zinc-100"
              />
              <p className="text-xs text-zinc-500">
                How many source chunks to retrieve per question (higher = more
                context, more noise).
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <label htmlFor="chat-threshold">threshold</label>
                <span className="tabular-nums text-zinc-900 dark:text-zinc-50">
                  {threshold.toFixed(2)}
                </span>
              </div>
              <input
                id="chat-threshold"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={threshold}
                onChange={(e) =>
                  setThreshold(Number.parseFloat(e.target.value))
                }
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-zinc-900 dark:bg-zinc-800 dark:accent-zinc-100"
              />
              <p className="text-xs text-zinc-500">
                Minimum similarity a chunk must clear to be used (lower =
                broader matches, higher = stricter relevance).
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Message list — aria-live="polite" so new assistant turns and the
          loading indicator are announced without interrupting the user. */}
      <div
        className="flex min-h-[280px] flex-col gap-4 rounded-lg border border-zinc-200 bg-zinc-50/40 p-4 dark:border-zinc-800 dark:bg-zinc-900/30"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
      >
        {!hasMessages ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <Sparkles className="size-4" aria-hidden="true" />
              Ask a question about your documents.
            </div>
            <p className="max-w-md text-xs text-zinc-500">
              Try one of these to get started:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestionButtons}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              expandedSources={expandedSources}
              onCitationJump={scrollToSource}
              onToggleSource={toggleSourceExpanded}
            />
          ))
        )}

        {loading ? (
          <div className="flex justify-start" aria-label="Assistant is thinking">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Thinking
              <span className="inline-flex w-4 justify-start">
                <span className="animate-pulse">…</span>
              </span>
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <p className="font-medium">Query failed</p>
          <p className="mt-1 break-words">{errorMessage}</p>
        </div>
      ) : null}

      {/* Input — wrapped in a real <form> so Enter submission, native form
          validation, and assistive tech all behave as expected. */}
      <form className="flex items-end gap-2" onSubmit={onSubmitForm}>
        <label htmlFor="chat-question-input" className="sr-only">
          Ask a question about your documents
        </label>
        <textarea
          id="chat-question-input"
          name="question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading || disabled}
          rows={2}
          placeholder={
            disabled
              ? "Index a document above to enable chat…"
              : "Ask about your documents… (Enter to send, Shift+Enter for newline)"
          }
          className="min-h-[64px] flex-1 resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
        />
        <Button
          type="submit"
          disabled={loading || disabled || input.trim().length === 0}
          size="lg"
          aria-label="Send question"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          <span>Send</span>
        </Button>
      </form>
    </div>
  );
}

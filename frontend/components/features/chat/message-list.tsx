"use client";

// Scroll region wrapping the message bubbles.
//
// WHY the non-default scroll behavior: a typical chat list pins the viewport
// to the BOTTOM on every new message. That works for SMS but fights the user
// here — when you send a question and a long cited answer arrives, the
// viewport ends at the bottom of the answer, so you have to scroll back UP
// to re-read your own question. Instead we mirror the ChatGPT / Claude
// pattern: on a new user message, scroll so that message sits at the TOP
// of the viewport, leaving room below for the assistant turn to appear
// where the user's reading eye already is. We do NOT auto-scroll on every
// assistant or pending update — the user is in control after that.
//
// The `bottomSpacer` keeps enough empty room below the latest turn that the
// scroll-to-top positioning actually has somewhere to go. Without it, a
// short thread can't scroll the user's message to the top (there's
// literally no more content to push).

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
} from "react";

import {
  MessageBubble,
  type ChatMessage,
} from "@/components/features/chat/message-bubble";
import { cn } from "@/lib/utils";

type MessageListProps = {
  messages: ChatMessage[];
  className?: string;
};

export function MessageList({
  messages,
  className,
}: MessageListProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastUserIdRef = useRef<string | null>(null);

  const latestUserId =
    [...messages].reverse().find((m) => m.role === "user")?.id ?? null;

  // useLayoutEffect — fire before paint so the scroll shift isn't visible as
  // a jitter. `block: "start"` pins the element to the top; scroll-margin is
  // controlled via a Tailwind class on the wrapper.
  useLayoutEffect(() => {
    if (!latestUserId || latestUserId === lastUserIdRef.current) return;
    lastUserIdRef.current = latestUserId;

    const el = messageRefs.current.get(latestUserId);
    if (!el) return;
    // Scroll the message's top to the container's top. Small timeout lets
    // the pending bubble mount so the spacer height is correct before we
    // measure-by-scrolling.
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [latestUserId]);

  // On very first load, jump to the bottom so any previous scroll position
  // doesn't carry over from browser history.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    c.scrollTop = c.scrollHeight;
    // intentionally single-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation"
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card/40 p-4",
        // WHY scroll-padding: reserves a few px at the top so `block: start`
        // doesn't wedge the user's bubble flush against the container edge.
        "scroll-pt-2",
        className,
      )}
    >
      {messages.map((m) => (
        <div
          key={m.id}
          ref={(el) => {
            if (el) messageRefs.current.set(m.id, el);
            else messageRefs.current.delete(m.id);
          }}
        >
          <MessageBubble message={m} />
        </div>
      ))}
      {/* Spacer — gives scroll-to-top somewhere to land. Hidden once the
          thread is long enough to fill naturally. */}
      {messages.length > 0 ? (
        <div aria-hidden className="min-h-[50vh] shrink-0" />
      ) : null}
    </div>
  );
}

"use client";

// Scroll region wrapping the message bubbles.
// WHY: `role="log" aria-live="polite"` announces new assistant turns
// without interrupting ongoing speech. Auto-scrolls to the bottom on new
// messages; the sentinel ref lets us `scrollIntoView` without measuring.

import { useEffect, useRef, type ReactElement } from "react";

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
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation"
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card/40 p-4",
        className,
      )}
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      <div ref={bottomRef} aria-hidden />
    </div>
  );
}

"use client";

// WHY: ChatInterface is a heavy client island (markdown rendering, chat state,
// citation expansion) that lives below the fold on the portfolio page. Lazy
// loading it via next/dynamic keeps it out of the initial JS payload for
// reviewers who never scroll past the model comparison.

import dynamic from "next/dynamic";
import type { ReactElement } from "react";

const ChatInterface = dynamic(
  () => import("./chat-interface").then((m) => m.ChatInterface),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        aria-live="polite"
        className="h-48 animate-pulse rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <span className="sr-only">Loading chat…</span>
      </div>
    ),
  },
);

export function ChatInterfaceLazy(props: {
  portfolio_id: string;
  disabled?: boolean;
}): ReactElement {
  return <ChatInterface {...props} />;
}

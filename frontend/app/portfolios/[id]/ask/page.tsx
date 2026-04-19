// Ask page — full-viewport chat over indexed documents.
// WHY: server component checks whether any documents have finished embedding;
// ChatPanel is disabled otherwise (shows an EmptyState). This route needs the
// full remaining viewport height so the composer sticks to the bottom and the
// message list scrolls independently — hence the calc() on the root flex col.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { ChatPanel } from "@/components/features/chat/chat-panel";
import { SectionHeader } from "@/components/state/section-header";
import { createServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function AskPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioRes, documentsRes] = await Promise.all([
    supabase.from("portfolios").select("id").eq("id", id).maybeSingle(),
    supabase
      .from("documents")
      .select("embedding_status")
      .eq("portfolio_id", id),
  ]);

  if (documentsRes.error) {
    throw new Error(`Failed to load documents: ${documentsRes.error.message}`);
  }
  if (!portfolioRes.data) notFound();

  const documents = documentsRes.data ?? [];
  const hasIndexedDocuments = documents.some(
    (d) => d.embedding_status === "complete",
  );

  // WHY: 100dvh - 3.5rem (topbar h-14) — lets the chat panel own the full
  // remaining column height; min-h-0 on the grow child is required so the
  // flex parent allows the scroll container inside MessageList to shrink.
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
      <SectionHeader
        title="Ask"
        description={
          hasIndexedDocuments
            ? "Ask a question over the indexed documents. Cmd/Ctrl+Enter to send."
            : "Upload and index at least one document to enable chat."
        }
      />
      <div className="min-h-0 min-w-0 flex-1">
        <ChatPanel
          portfolioId={id}
          disabled={!hasIndexedDocuments}
          className="h-full"
        />
      </div>
    </div>
  );
}

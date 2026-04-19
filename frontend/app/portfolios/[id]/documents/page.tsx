// Documents page — upload PDFs/DOCX/TXT and view the embed pipeline status.
// WHY: server component fetches the document list. DocumentUpload's insert
// triggers a router.refresh() which re-runs this server component, so the
// list stays in sync without explicit polling.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { DocumentList } from "@/components/features/document-list";
import { DocumentUpload } from "@/components/features/document-upload";
import { SectionHeader } from "@/components/state/section-header";
import { createServerSupabase } from "@/lib/supabase";
import type { DocumentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function DocumentsPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioRes, documentsRes] = await Promise.all([
    supabase.from("portfolios").select("id").eq("id", id).maybeSingle(),
    supabase
      .from("documents")
      .select(
        "id, portfolio_id, filename, storage_path, chunk_count, embedding_status, uploaded_at",
      )
      .eq("portfolio_id", id)
      .order("uploaded_at", { ascending: false }),
  ]);

  if (documentsRes.error) {
    throw new Error(`Failed to load documents: ${documentsRes.error.message}`);
  }
  if (!portfolioRes.data) notFound();

  const documents = (documentsRes.data ?? []) as DocumentRow[];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader
        title="Documents"
        description="Upload PDFs, DOCX, or TXT. Each file is chunked and embedded (gte-small, 384 dims)."
      />
      <DocumentUpload portfolio_id={id} />
      <DocumentList documents={documents} />
    </div>
  );
}

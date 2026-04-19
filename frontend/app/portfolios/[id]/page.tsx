// Portfolio detail page — dashboard shell + overview + projects + anomalies + models.
// WHY: server component so the initial load is SSR'd with no client-side
// data fetching dance. Interactivity is scoped to client leaves (cleaning
// report panel, Recharts summary, train button, model comparison). Sections
// are anchored with #overview / #projects / #anomalies / #models so the
// sidebar nav can jump to them.

import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase";
import type { DocumentRow, ModelRun, Portfolio, ProjectRow } from "@/lib/types";
import { CleaningReportPanel } from "@/components/cleaning-report-panel";
import { ProjectsTable } from "@/components/projects-table";
import { PortfolioSummary } from "@/components/portfolio-summary";
import { AnomalyList } from "@/components/anomaly-list";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModelComparison } from "@/components/model-comparison";
import { TrainModelsButton } from "@/components/train-models-button";
import { DocumentUpload } from "@/components/document-upload";
import { DocumentList } from "@/components/document-list";
import { ChatInterfaceLazy } from "@/components/chat-interface-lazy";

export const dynamic = "force-dynamic";

// WHY: must match MINIMUM_TRAINING_SAMPLES in ml-service/models.py. Keeping
// this as a local constant here (rather than importing) so the SSR bundle
// doesn't drag in Python-flavoured deps. If the Python side changes, this
// grep target will surface it in code review.
const MINIMUM_TRAINING_SAMPLES = 5;

type PageProps = {
  params: Promise<{ id: string }>;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(iso: string): string {
  try {
    return dateFormatter.format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function PortfolioDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // WHY: fetch in parallel — the projects and model_runs queries do not
  // depend on the portfolio existing, and we want all three before
  // deciding how to render.
  const [portfolioResult, projectsResult, modelRunsResult, documentsResult] =
    await Promise.all([
      supabase
        .from("portfolios")
        .select("id, name, row_count, anomaly_count, cleaning_report, created_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("projects")
        .select(
          "id, portfolio_id, project_id_external, project_name, project_type, contract_value_usd, start_date, end_date, region, subcontractor_count, delay_days, cost_overrun_pct, safety_incidents, payment_disputes, final_status, actual_duration_days, anomaly_flags",
        )
        .eq("portfolio_id", id)
        .order("project_id_external", { ascending: true }),
      supabase
        .from("model_runs")
        .select(
          "id, portfolio_id, model_type, accuracy, feature_importances, features_used, n_training_samples, created_at",
        )
        .eq("portfolio_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("documents")
        .select(
          "id, portfolio_id, filename, storage_path, chunk_count, embedding_status, uploaded_at",
        )
        .eq("portfolio_id", id)
        .order("uploaded_at", { ascending: false }),
    ]);

  if (portfolioResult.error) {
    // NOTE: surface the DB error verbatim — easier to debug the cloud-vs-
    // local auth split than to invent our own message.
    throw new Error(
      `Failed to load portfolio: ${portfolioResult.error.message}`,
    );
  }
  if (projectsResult.error) {
    throw new Error(
      `Failed to load projects: ${projectsResult.error.message}`,
    );
  }
  if (modelRunsResult.error) {
    throw new Error(
      `Failed to load model runs: ${modelRunsResult.error.message}`,
    );
  }
  if (documentsResult.error) {
    throw new Error(
      `Failed to load documents: ${documentsResult.error.message}`,
    );
  }
  if (!portfolioResult.data) {
    notFound();
  }

  const portfolio = portfolioResult.data as Portfolio;
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const modelRuns = (modelRunsResult.data ?? []) as ModelRun[];
  const documents = (documentsResult.data ?? []) as DocumentRow[];
  const hasIndexedDocuments = documents.some(
    (d) => d.embedding_status === "complete",
  );

  // WHY: the training endpoint refuses below MINIMUM_TRAINING_SAMPLES,
  // so pre-emptively disable the button to spare the user a 400 round-trip.
  const completedCount = projects.filter(
    (p) => p.final_status === "Completed",
  ).length;
  const canTrain = completedCount >= MINIMUM_TRAINING_SAMPLES;

  return (
    <DashboardShell portfolio={portfolio}>
      <div className="space-y-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {portfolio.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Created {formatCreatedAt(portfolio.created_at)} ·{" "}
            <span className="tabular-nums">{portfolio.row_count}</span> rows ·{" "}
            <span className="tabular-nums">{portfolio.anomaly_count}</span>{" "}
            anomalies
          </p>
        </header>

        <CleaningReportPanel
          report={portfolio.cleaning_report ?? {}}
          rowCount={portfolio.row_count}
          anomalyCount={portfolio.anomaly_count}
        />

        {/* WHY: id="overview" etc. are the anchor targets the sidebar nav in
            DashboardShell jumps to. Keep these in sync with NAV_ITEMS. */}
        <section
          id="overview"
          aria-labelledby="overview-heading"
          className="scroll-mt-20 space-y-4"
        >
          <h2
            id="overview-heading"
            className="text-sm font-medium uppercase tracking-wide text-zinc-500"
          >
            Overview
          </h2>
          <PortfolioSummary portfolio={portfolio} projects={projects} />
        </section>

        <section
          id="projects"
          aria-labelledby="projects-heading"
          className="scroll-mt-20 space-y-4"
        >
          <h2
            id="projects-heading"
            className="text-sm font-medium uppercase tracking-wide text-zinc-500"
          >
            Projects
          </h2>
          <ProjectsTable rows={projects} />
        </section>

        <section
          id="anomalies"
          aria-labelledby="anomalies-heading"
          className="scroll-mt-20 space-y-4"
        >
          <h2
            id="anomalies-heading"
            className="text-sm font-medium uppercase tracking-wide text-zinc-500"
          >
            Anomalies
          </h2>
          <AnomalyList projects={projects} />
        </section>

        <section
          id="models"
          aria-labelledby="models-heading"
          className="scroll-mt-20 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="models-heading"
              className="text-sm font-medium uppercase tracking-wide text-zinc-500"
            >
              Models
            </h2>
            <div className="flex items-center gap-3">
              {!canTrain ? (
                <p className="text-xs text-zinc-500">
                  Need at least {MINIMUM_TRAINING_SAMPLES} completed projects to
                  train ({completedCount} available).
                </p>
              ) : null}
              <TrainModelsButton portfolioId={portfolio.id} disabled={!canTrain} />
            </div>
          </div>
          <ModelComparison runs={modelRuns} />
        </section>

        <section
          id="documents"
          aria-labelledby="documents-heading"
          className="scroll-mt-20 space-y-4"
        >
          <div>
            <h2
              id="documents-heading"
              className="text-sm font-medium uppercase tracking-wide text-zinc-500"
            >
              Documents
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Upload PDF, DOCX, or TXT. Each file is chunked and embedded
              (gte-small, 384 dims) so you can ask questions about it below.
            </p>
          </div>
          <DocumentUpload portfolio_id={portfolio.id} />
          <DocumentList documents={documents} />
        </section>

        <section
          id="ask"
          aria-labelledby="ask-heading"
          className="scroll-mt-20 space-y-4"
        >
          <div>
            <h2
              id="ask-heading"
              className="text-sm font-medium uppercase tracking-wide text-zinc-500"
            >
              Ask
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {hasIndexedDocuments
                ? "Ask a question over the indexed documents. Answers are cited to source chunks."
                : "Upload and index at least one document above to enable the chat."}
            </p>
          </div>
          <ChatInterfaceLazy
            portfolio_id={portfolio.id}
            disabled={!hasIndexedDocuments}
          />
        </section>
      </div>
    </DashboardShell>
  );
}

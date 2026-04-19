// Model comparison page — naive vs. pre-construction.
// WHY: server component fetches the most recent runs per model_type plus a
// projects query scoped to `final_status` only, used to decide whether the
// Train button should be enabled. ModelComparison owns the side-by-side
// Linear-clean layout.

import type { ReactElement } from "react";
import { notFound } from "next/navigation";

import { ModelComparison } from "@/components/features/model-comparison";
import { TrainModelsButton } from "@/components/features/train-models-button";
import { SectionHeader } from "@/components/state/section-header";
import { createServerSupabase } from "@/lib/supabase";
import type { ModelRun, ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

// WHY: mirror ml-service's `MINIMUM_COMPLETED_PROJECTS = 5` so the UI disables
// training in exactly the cases FastAPI would reject. If the constant ever
// changes on the server, the error toast from TrainModelsButton still
// surfaces the authoritative number.
const MINIMUM_TRAINING_SAMPLES = 5;

type PageProps = { params: Promise<{ id: string }> };

export default async function ModelsPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [portfolioRes, projectsRes, modelsRes] = await Promise.all([
    supabase.from("portfolios").select("id").eq("id", id).maybeSingle(),
    supabase.from("projects").select("final_status").eq("portfolio_id", id),
    supabase
      .from("model_runs")
      .select(
        "id, portfolio_id, model_type, accuracy, feature_importances, features_used, n_training_samples, created_at",
      )
      .eq("portfolio_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (modelsRes.error) {
    throw new Error(`Failed to load model runs: ${modelsRes.error.message}`);
  }
  if (!portfolioRes.data) notFound();

  const modelRuns = (modelsRes.data ?? []) as ModelRun[];
  const projects = (projectsRes.data ?? []) as Pick<ProjectRow, "final_status">[];
  const completedCount = projects.filter(
    (p) => p.final_status === "Completed",
  ).length;
  const canTrain = completedCount >= MINIMUM_TRAINING_SAMPLES;

  const disabledReason = canTrain
    ? undefined
    : `Need at least ${MINIMUM_TRAINING_SAMPLES} completed projects (${completedCount} available).`;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <SectionHeader
        title="Model comparison"
        description="Naive vs. pre-construction"
        actions={
          <TrainModelsButton
            portfolioId={id}
            disabled={!canTrain}
            disabledReason={disabledReason}
          />
        }
      />

      {!canTrain ? (
        <p className="text-meta">
          Need at least {MINIMUM_TRAINING_SAMPLES} completed projects (
          {completedCount} available).
        </p>
      ) : null}

      <ModelComparison runs={modelRuns} />
    </div>
  );
}

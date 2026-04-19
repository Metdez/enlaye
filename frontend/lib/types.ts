// Shared domain types — mirror ARCHITECTURE.md § Database Schema.
// WHY: keeping these in one file means the Supabase client, server
// components, API routes, and UI all agree on row shapes. When the
// schema changes, update here first, then migrations.

export type Portfolio = {
  id: string;
  name: string;
  cleaning_report: CleaningReport;
  row_count: number;
  anomaly_count: number;
  created_at: string;
};

export type CleaningReport = {
  imputations?: Array<{ column: string; n_filled: number; value: number }>;
  type_coercions?: Array<{ column: string; from: string; to: string }>;
  rows_rejected?: number;
};

export type ProjectSource = "csv" | "manual";

export type ProjectRow = {
  id: string;
  portfolio_id: string;
  project_id_external: string | null;
  project_name: string | null;
  project_type: string | null;
  contract_value_usd: number | null;
  start_date: string | null;
  end_date: string | null;
  region: string | null;
  subcontractor_count: number | null;
  delay_days: number | null;
  cost_overrun_pct: number | null;
  safety_incidents: number | null;
  payment_disputes: number | null;
  final_status: "Completed" | "In Progress" | null;
  actual_duration_days: number | null;
  anomaly_flags: string[];
  // Phase 8c — provenance. 'csv' for rows ingested from uploaded CSVs,
  // 'manual' for rows added/edited via the UI feedback loop.
  source: ProjectSource;
};

// Phase 8c — request/response shapes for the user-facing feedback loop.
// Matches ml-service/main.py `/projects/upsert` and `/projects/delete`.
// WHY: keep the keys in lockstep with the backend Pydantic models so any
// drift surfaces as a TypeScript error, not a 422 at runtime.

export type ProjectUpsertInput = {
  /** Present on update-by-id. Omit for inserts. */
  id?: string;
  /** Required, unique within the portfolio. Read-only on edit. */
  project_id_external: string;
  project_name?: string | null;
  project_type?: string | null;
  contract_value_usd?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  region?: string | null;
  subcontractor_count?: number | null;
  delay_days?: number | null;
  cost_overrun_pct?: number | null;
  safety_incidents?: number | null;
  payment_disputes?: number | null;
  final_status?: "Completed" | "In Progress" | null;
  actual_duration_days?: number | null;
  anomaly_flags?: string[];
};

export type ProjectUpsertRequest = {
  portfolio_id: string;
  project: ProjectUpsertInput;
};

export type ProjectUpsertResponse = {
  project: ProjectRow;
  analyze: AnalyzeResponse;
};

export type ProjectDeleteRequest = {
  portfolio_id: string;
  project_id: string;
};

export type ProjectDeleteResponse = {
  deleted_id: string;
  analyze: AnalyzeResponse;
};

export type ModelType = "naive" | "pre_construction";

export type ModelRun = {
  id: string;
  portfolio_id: string;
  model_type: ModelType;
  accuracy: number | null;
  feature_importances: Record<string, number> | null;
  features_used: string[] | null;
  n_training_samples: number | null;
  created_at: string;
};

// Risk intelligence (Phase 8a) — derived tables written by POST /api/ml/analyze.
// WHY: these shapes are locked by the ML service response; keeping them in
// lib/types.ts lets pages, client components, and the API proxy all share
// one source of truth. Mirror `supabase/migrations/<ts>_risk_intelligence_tables.sql`.

export type RiskSubscoreKey =
  | "type_risk"
  | "region_risk"
  | "size_risk"
  | "complexity_risk"
  | "duration_risk";

export type RiskBreakdown = {
  subscores: Record<RiskSubscoreKey, number>; // each 0-1
  weights: Record<RiskSubscoreKey, number>; // each 0-1, sum ~= 1 (0.2 default)
  top_driver: RiskSubscoreKey;
  flags: Array<"sparse_type" | "sparse_region" | "unknown_duration">;
};

export type RiskScore = {
  id: string;
  project_id: string;
  portfolio_id: string;
  score: number; // 0-100
  breakdown: RiskBreakdown;
  computed_at: string;
};

export type HeuristicRuleOutcome =
  | "high_overrun"
  | "high_delay"
  | "any_safety_incident"
  | "any_dispute";

export type HeuristicRuleConfidence = "low" | "medium" | "high";

export type HeuristicRule = {
  id: string;
  portfolio_id: string;
  scope: string; // e.g. "project_type=Infrastructure"
  outcome: HeuristicRuleOutcome;
  rate: number; // 0-1
  sample_size: number;
  ci_low: number;
  ci_high: number;
  confidence: HeuristicRuleConfidence;
  computed_at: string;
};

export type ProjectSegment = {
  id: string;
  project_id: string;
  portfolio_id: string;
  size_bucket: "small" | "medium" | "large";
  normalized_delay: number | null;
  cluster_id: number | null; // 0 = ungrouped
  computed_at: string;
};

export type AnalyzeResponse = {
  portfolio_id: string;
  n_projects: number;
  n_rules: number;
};

// Scenario simulator (Phase 8b) — cohort-based outcome estimates returned
// by POST /api/ml/simulate. Every percentile / rate can be null when the
// cohort is too small, so the UI must render an explicit n/a chip rather
// than coerce missing data into 0. Mirrors `ml-service/scenarios.py`.

export type SimulateConfidence = "low" | "medium" | "high";

export type SimulateRequest = {
  portfolio_id: string;
  project_type: string;
  region: string;
  contract_value_usd: number;
  subcontractor_count: number;
  /** Cohort size requested; defaults server-side to 5, clamped to ≤ 20. */
  k?: number;
};

export type SimulateOutcomeRange = {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  n: number;
  confidence: SimulateConfidence;
};

export type SimulateOutcomeRate = {
  rate: number | null; // 0-1
  ci_low: number;
  ci_high: number;
  n: number;
  confidence: SimulateConfidence;
};

export type SimulateOutcomes = {
  delay_days: SimulateOutcomeRange;
  cost_overrun_pct: SimulateOutcomeRange;
  safety_incidents: SimulateOutcomeRange;
  any_dispute: SimulateOutcomeRate;
};

export type SimulateResponse = {
  portfolio_id: string;
  cohort_size: number;
  k_requested: number;
  similar_project_ids: string[];
  outcomes: SimulateOutcomes;
  caveats: string[];
};

export type EmbeddingStatus = "pending" | "complete" | "failed";

export type DocumentRow = {
  id: string;
  portfolio_id: string;
  filename: string;
  storage_path: string;
  chunk_count: number;
  embedding_status: EmbeddingStatus;
  uploaded_at: string;
};

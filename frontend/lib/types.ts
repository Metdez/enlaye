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

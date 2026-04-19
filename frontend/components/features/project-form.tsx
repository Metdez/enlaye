"use client";

// Shared project form used by the add-dialog and the edit-sheet.
// WHY: keeping one component means the two entry points stay visually and
// semantically identical — same section order, same validation, same copy.
// We avoid react-hook-form here to match the existing Screen/Scenario pattern
// in this repo (plain controlled inputs). For ~15 fields the overhead of a
// forms lib would exceed its benefit.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProjectRow, ProjectUpsertInput } from "@/lib/types";

// WHY: the Screen page uses this exact <select> styling. Keep it inline so
// the two forms read the same without importing a custom Select wrapper that
// doesn't exist yet.
// WHY: native <select> popup ignores Tailwind. Set color-scheme so the OS
// picker adopts the current theme, and give <option> explicit bg/color so
// dark-mode text stays readable on all browsers/OSes.
const SELECT_CLASSES =
  "h-8 w-full rounded-lg border border-input bg-background text-foreground [color-scheme:light] dark:[color-scheme:dark] px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";
const OPTION_CLASSES = "bg-background text-foreground";

type ProjectFormProps = {
  /** Undefined => add mode; a partial project => edit mode. */
  initial?: Partial<ProjectRow>;
  /** Distinct project_type values drawn from the portfolio (or a fallback). */
  typeOptions: string[];
  /** Distinct region values drawn from the portfolio (or a fallback). */
  regionOptions: string[];
  /** Must throw on backend error — the form surfaces the thrown message. */
  onSubmit: (values: ProjectUpsertInput) => Promise<void>;
  submitting: boolean;
  submitLabel?: string;
  /** `aria-labelledby` id for the containing dialog/sheet title. */
  titleId?: string;
  className?: string;
};

// Local "field state" shape — everything stringly-typed so inputs can bind
// directly. We normalize in `toUpsertInput` before submit.
type FieldState = {
  project_id_external: string;
  project_name: string;
  project_type: string;
  region: string;
  contract_value_usd: string;
  start_date: string;
  end_date: string;
  subcontractor_count: string;
  delay_days: string;
  cost_overrun_pct: string;
  safety_incidents: string;
  payment_disputes: string;
  final_status: "" | "Completed" | "In Progress";
  actual_duration_days: string;
};

function numToStr(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "" : String(n);
}

function buildInitial(initial?: Partial<ProjectRow>): FieldState {
  return {
    project_id_external: initial?.project_id_external ?? "",
    project_name: initial?.project_name ?? "",
    project_type: initial?.project_type ?? "",
    region: initial?.region ?? "",
    contract_value_usd: numToStr(initial?.contract_value_usd),
    start_date: initial?.start_date ?? "",
    end_date: initial?.end_date ?? "",
    subcontractor_count: numToStr(initial?.subcontractor_count),
    delay_days: numToStr(initial?.delay_days),
    cost_overrun_pct: numToStr(initial?.cost_overrun_pct),
    safety_incidents: numToStr(initial?.safety_incidents),
    payment_disputes: numToStr(initial?.payment_disputes),
    final_status:
      initial?.final_status === "Completed" ||
      initial?.final_status === "In Progress"
        ? initial.final_status
        : "",
    actual_duration_days: numToStr(initial?.actual_duration_days),
  };
}

/** Parse a field-state string as a number. Empty → null. Non-numeric → NaN. */
function parseNumOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

function isIsoDate(raw: string): boolean {
  // YYYY-MM-DD — accept native <input type="date"> values and common manual input.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(raw);
  return !Number.isNaN(d.getTime());
}

type ValidationResult =
  | { ok: true; values: ProjectUpsertInput }
  | { ok: false; errors: string[] };

function validate(state: FieldState, editId: string | undefined): ValidationResult {
  const errors: string[] = [];

  const externalId = state.project_id_external.trim();
  if (!externalId) {
    errors.push("External project ID is required.");
  }

  // Numerics — separate parse pass so the message can name the field.
  const numericFields: Array<{
    key: keyof FieldState;
    label: string;
    nonNegative?: boolean;
  }> = [
    { key: "contract_value_usd", label: "Contract value", nonNegative: true },
    { key: "subcontractor_count", label: "Subcontractor count", nonNegative: true },
    { key: "delay_days", label: "Delay (days)" },
    { key: "cost_overrun_pct", label: "Cost overrun (%)" },
    { key: "safety_incidents", label: "Safety incidents", nonNegative: true },
    { key: "payment_disputes", label: "Payment disputes", nonNegative: true },
    { key: "actual_duration_days", label: "Actual duration (days)" },
  ];

  const parsed: Record<string, number | null> = {};
  for (const f of numericFields) {
    const raw = state[f.key] as string;
    const value = parseNumOrNull(raw);
    if (Number.isNaN(value)) {
      errors.push(`${f.label} must be a number.`);
      continue;
    }
    if (f.nonNegative && value != null && value < 0) {
      errors.push(`${f.label} must be zero or greater.`);
      continue;
    }
    parsed[f.key] = value;
  }

  // Dates — if one is set, we tolerate; the backend allows either/both.
  // We only reject truly malformed strings.
  if (state.start_date && !isIsoDate(state.start_date)) {
    errors.push("Start date must be a valid YYYY-MM-DD date.");
  }
  if (state.end_date && !isIsoDate(state.end_date)) {
    errors.push("End date must be a valid YYYY-MM-DD date.");
  }

  if (errors.length > 0) return { ok: false, errors };

  const values: ProjectUpsertInput = {
    project_id_external: externalId,
    project_name: state.project_name.trim() || null,
    project_type: state.project_type.trim() || null,
    region: state.region.trim() || null,
    contract_value_usd: parsed.contract_value_usd ?? null,
    start_date: state.start_date || null,
    end_date: state.end_date || null,
    subcontractor_count: parsed.subcontractor_count ?? null,
    delay_days: parsed.delay_days ?? null,
    cost_overrun_pct: parsed.cost_overrun_pct ?? null,
    safety_incidents: parsed.safety_incidents ?? null,
    payment_disputes: parsed.payment_disputes ?? null,
    final_status:
      state.final_status === "" ? null : state.final_status,
    actual_duration_days: parsed.actual_duration_days ?? null,
  };
  if (editId) values.id = editId;
  return { ok: true, values };
}

export function ProjectForm({
  initial,
  typeOptions,
  regionOptions,
  onSubmit,
  submitting,
  submitLabel = "Save",
  titleId,
  className,
}: ProjectFormProps): ReactElement {
  const isEdit = initial?.id !== undefined;
  const editId = initial?.id;

  const [state, setState] = useState<FieldState>(() => buildInitial(initial));
  const [errors, setErrors] = useState<string[] | null>(null);
  // WHY: collect external errors (from the mutation's thrown Error) as a
  // single-banner string. Client-side validation uses the array above; this
  // is a separate slot so a 409 doesn't wipe the typed validation messages.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const errorBannerRef = useRef<HTMLDivElement | null>(null);
  const formId = useId();

  // Re-seed when `initial` changes (parent swaps which project is being edited).
  useEffect(() => {
    setState(buildInitial(initial));
    setErrors(null);
    setSubmitError(null);
  }, [initial]);

  const update = useCallback(
    <K extends keyof FieldState>(key: K, value: FieldState[K]) => {
      setState((s) => ({ ...s, [key]: value }));
    },
    [],
  );

  const activeErrors = useMemo(() => {
    if (errors && errors.length > 0) return errors;
    if (submitError) return [submitError];
    return null;
  }, [errors, submitError]);

  // Focus the error banner when it appears so screen readers announce it.
  useEffect(() => {
    if (activeErrors && errorBannerRef.current) {
      errorBannerRef.current.focus();
    }
  }, [activeErrors]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    const result = validate(state, editId);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors(null);

    try {
      await onSubmit(result.values);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      aria-labelledby={titleId}
      noValidate
      className={cn("flex flex-col gap-5", className)}
    >
      {activeErrors ? (
        <div
          ref={errorBannerRef}
          role="alert"
          aria-live="polite"
          tabIndex={-1}
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-body text-destructive focus:outline-none"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">
              {activeErrors.length === 1 ? "Fix this before saving" : "Fix these before saving"}
            </p>
            <ul className="space-y-0.5 text-meta">
              {activeErrors.map((err, i) => (
                <li key={i}>• {err}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* IDENTITY */}
      <section className="flex flex-col gap-3">
        <h3 className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          Identity
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-external`}>
              External ID<span aria-hidden className="text-destructive">*</span>
            </Label>
            <Input
              id={`${formId}-external`}
              value={state.project_id_external}
              onChange={(e) => update("project_id_external", e.target.value)}
              readOnly={isEdit}
              disabled={isEdit}
              required
              aria-required="true"
              aria-invalid={
                errors?.some((msg) =>
                  msg.toLowerCase().includes("external project id"),
                ) || undefined
              }
              placeholder="e.g. PRJ-042"
              className="font-mono"
            />
            <p className="text-meta text-muted-foreground">
              {isEdit
                ? "Locked — used as the unique key within the portfolio."
                : "Unique within the portfolio. Required."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-name`}>Project name</Label>
            <Input
              id={`${formId}-name`}
              value={state.project_name}
              onChange={(e) => update("project_name", e.target.value)}
              placeholder="Short human label"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-type`}>Project type</Label>
            <select
              id={`${formId}-type`}
              value={state.project_type}
              onChange={(e) => update("project_type", e.target.value)}
              className={SELECT_CLASSES}
            >
              <option value="" className={OPTION_CLASSES}>—</option>
              {typeOptions.map((opt) => (
                <option key={opt} value={opt} className={OPTION_CLASSES}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-region`}>Region</Label>
            <select
              id={`${formId}-region`}
              value={state.region}
              onChange={(e) => update("region", e.target.value)}
              className={SELECT_CLASSES}
            >
              <option value="" className={OPTION_CLASSES}>—</option>
              {regionOptions.map((opt) => (
                <option key={opt} value={opt} className={OPTION_CLASSES}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <div className="border-t border-border" />

      {/* SCOPE */}
      <section className="flex flex-col gap-3">
        <h3 className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          Scope
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-contract`}>Contract value</Label>
            <Input
              id={`${formId}-contract`}
              type="number"
              inputMode="decimal"
              min={0}
              step={100_000}
              value={state.contract_value_usd}
              onChange={(e) => update("contract_value_usd", e.target.value)}
              placeholder="0"
            />
            <p className="text-meta text-muted-foreground">USD</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-subs`}>Subcontractor count</Label>
            <Input
              id={`${formId}-subs`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={state.subcontractor_count}
              onChange={(e) => update("subcontractor_count", e.target.value)}
              placeholder="0"
            />
            <p className="text-meta text-muted-foreground">Whole number ≥ 0</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-start`}>Start date</Label>
            <Input
              id={`${formId}-start`}
              type="date"
              value={state.start_date}
              onChange={(e) => update("start_date", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-end`}>End date</Label>
            <Input
              id={`${formId}-end`}
              type="date"
              value={state.end_date}
              onChange={(e) => update("end_date", e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="border-t border-border" />

      {/* OUTCOMES */}
      <section className="flex flex-col gap-3">
        <h3 className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          Outcomes
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-delay`}>Delay</Label>
            <Input
              id={`${formId}-delay`}
              type="number"
              inputMode="numeric"
              step={1}
              value={state.delay_days}
              onChange={(e) => update("delay_days", e.target.value)}
              placeholder="0"
            />
            <p className="text-meta text-muted-foreground">Days (negative allowed)</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-overrun`}>Cost overrun</Label>
            <Input
              id={`${formId}-overrun`}
              type="number"
              inputMode="decimal"
              step={0.1}
              value={state.cost_overrun_pct}
              onChange={(e) => update("cost_overrun_pct", e.target.value)}
              placeholder="0"
            />
            <p className="text-meta text-muted-foreground">Percent (e.g. 12.5)</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-safety`}>Safety incidents</Label>
            <Input
              id={`${formId}-safety`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={state.safety_incidents}
              onChange={(e) => update("safety_incidents", e.target.value)}
              placeholder="0"
            />
            <p className="text-meta text-muted-foreground">Whole number ≥ 0</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-disputes`}>Payment disputes</Label>
            <Input
              id={`${formId}-disputes`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={state.payment_disputes}
              onChange={(e) => update("payment_disputes", e.target.value)}
              placeholder="0"
            />
            <p className="text-meta text-muted-foreground">Whole number ≥ 0</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-status`}>Final status</Label>
            <select
              id={`${formId}-status`}
              value={state.final_status}
              onChange={(e) =>
                update(
                  "final_status",
                  e.target.value as FieldState["final_status"],
                )
              }
              className={SELECT_CLASSES}
            >
              <option value="" className={OPTION_CLASSES}>—</option>
              <option value="In Progress" className={OPTION_CLASSES}>In Progress</option>
              <option value="Completed" className={OPTION_CLASSES}>Completed</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-actual`}>Actual duration</Label>
            <Input
              id={`${formId}-actual`}
              type="number"
              inputMode="numeric"
              step={1}
              value={state.actual_duration_days}
              onChange={(e) => update("actual_duration_days", e.target.value)}
              placeholder="Auto from dates if empty"
            />
            <p className="text-meta text-muted-foreground">
              Days. Backend will compute from dates when omitted.
            </p>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <Loader2 aria-hidden className="animate-spin" />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </form>
  );
}

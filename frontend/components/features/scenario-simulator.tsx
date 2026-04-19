"use client";

// Scenario simulator — left-side form + right-side live outcome preview.
// WHY: client component. The form state + debounced POST + AbortController
// dance only makes sense in the browser. The page passes `projectsById`
// (server-fetched) down so the "Similar projects" list can resolve ids
// to names without re-fetching from the client.

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";

import { DistributionStrip } from "@/components/data/distribution-strip";
import { StatusDot, type StatusTone } from "@/components/data/status-dot";
import { EmptyState } from "@/components/state/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  SimulateConfidence,
  SimulateOutcomeRange,
  SimulateOutcomeRate,
  SimulateRequest,
  SimulateResponse,
} from "@/lib/types";

// Lightweight projection of ProjectRow needed for the "similar projects"
// lookup. The page owns the fetch; we only need the columns we render.
type SimilarProjectLookup = {
  id: string;
  project_name: string | null;
  project_id_external: string | null;
  delay_days: number | null;
  cost_overrun_pct: number | null;
  final_status: string | null;
};

type ScenarioSimulatorProps = {
  portfolioId: string;
  typeOptions: string[];
  regionOptions: string[];
  projectsById: Record<string, SimilarProjectLookup>;
};

type FormState = {
  project_type: string;
  region: string;
  contract_value_usd: number;
  subcontractor_count: number;
  k: number;
};

const DEFAULT_CONTRACT = 30_000_000;
const DEFAULT_SUBCONTRACTORS = 10;
const DEFAULT_K = 5;
const DEBOUNCE_MS = 400;

// WHY: the StatusDot tones align with our three confidence levels; keep
// this table alongside the component that consumes it so the mapping is
// obvious at the call site.
const CONFIDENCE_TONE: Record<SimulateConfidence, StatusTone> = {
  low: "warning",
  medium: "info",
  high: "success",
};

const CONFIDENCE_LABEL: Record<SimulateConfidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

function pickInitial(options: string[], fallback: string): string {
  return options.length > 0 ? options[0] : fallback;
}

function fmtDays(n: number): string {
  // NOTE: keeping this a plain Math.round renders "12 days" vs "12.4";
  // delay is measured in whole days so decimals would be fake precision.
  return `${Math.round(n)}d`;
}

function fmtPctRate(n: number): string {
  return formatPercent(n, 1);
}

/** Format a raw ratio (0-1) as a percentage — used for `any_dispute.rate`. */
function fmtRate(n: number | null): string {
  if (n == null) return "n/a";
  return formatPercent(n * 100, 0);
}

function NaChip({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-meta text-muted-foreground">
      n/a (n={n})
    </span>
  );
}

type OutcomeBlockProps = {
  title: string;
  range: SimulateOutcomeRange;
  formatter: (n: number) => string;
};

function OutcomeBlock({ title, range, formatter }: OutcomeBlockProps) {
  const hasData = range.p50 != null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3">
      <p className="text-meta uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {hasData ? (
        <DistributionStrip
          percentiles={{ p25: range.p25, p50: range.p50, p75: range.p75 }}
          n={range.n}
          formatter={formatter}
        />
      ) : (
        <NaChip n={range.n} />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
        <span className="tabular-nums">n={range.n}</span>
        <StatusDot
          tone={CONFIDENCE_TONE[range.confidence]}
          label={CONFIDENCE_LABEL[range.confidence]}
          className="text-meta"
        />
      </div>
    </div>
  );
}

function DisputeBlock({ rate }: { rate: SimulateOutcomeRate }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3">
      <p className="text-meta uppercase tracking-wide text-muted-foreground">
        Dispute likelihood
      </p>
      {rate.rate != null ? (
        <p className="text-h2 tabular-nums text-foreground">
          {fmtRate(rate.rate)}
        </p>
      ) : (
        <NaChip n={rate.n} />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
        {rate.rate != null ? (
          <span className="tabular-nums">
            95% CI {formatPercent(rate.ci_low * 100, 0)}–
            {formatPercent(rate.ci_high * 100, 0)}
          </span>
        ) : null}
        <span className="tabular-nums">n={rate.n}</span>
        <StatusDot
          tone={CONFIDENCE_TONE[rate.confidence]}
          label={CONFIDENCE_LABEL[rate.confidence]}
          className="text-meta"
        />
      </div>
    </div>
  );
}

export function ScenarioSimulator({
  portfolioId,
  typeOptions,
  regionOptions,
  projectsById,
}: ScenarioSimulatorProps): ReactElement {
  const [form, setForm] = useState<FormState>(() => ({
    project_type: pickInitial(typeOptions, "Infrastructure"),
    region: pickInitial(regionOptions, "Northeast"),
    contract_value_usd: DEFAULT_CONTRACT,
    subcontractor_count: DEFAULT_SUBCONTRACTORS,
    k: DEFAULT_K,
  }));

  const [data, setData] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // WHY: increment on each "fire" so a stale response arriving after a
  // newer one has been kicked off is ignored on state commit.
  const [fetchNonce, setFetchNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const runSimulate = useCallback(
    async (body: SimulateRequest, nonce: number) => {
      // Abort any in-flight request.
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/ml/simulate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            text || `Simulate failed: ${res.status} ${res.statusText}`,
          );
        }
        const parsed = (await res.json()) as SimulateResponse;
        // Stale-response guard.
        if (nonce === fetchNonceRef.current) {
          setData(parsed);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (nonce === fetchNonceRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  // WHY: we read the latest nonce inside the async handler without adding
  // it to the deps (it would reset the abort controller every state tick).
  const fetchNonceRef = useRef(fetchNonce);
  useEffect(() => {
    fetchNonceRef.current = fetchNonce;
  }, [fetchNonce]);

  // Debounced fire on form changes (including initial mount).
  useEffect(() => {
    const nonce = fetchNonce + 1;
    setFetchNonce(nonce);
    const timer = window.setTimeout(() => {
      runSimulate(
        {
          portfolio_id: portfolioId,
          project_type: form.project_type,
          region: form.region,
          contract_value_usd: form.contract_value_usd,
          subcontractor_count: form.subcontractor_count,
          k: form.k,
        },
        nonce,
      );
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // WHY: we intentionally omit runSimulate + fetchNonce from deps. The
    // form values are the source of truth for "should we re-fire". Adding
    // fetchNonce would loop; runSimulate is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    portfolioId,
    form.project_type,
    form.region,
    form.contract_value_usd,
    form.subcontractor_count,
    form.k,
  ]);

  const handleRetry = useCallback(() => {
    const nonce = fetchNonce + 1;
    setFetchNonce(nonce);
    runSimulate(
      {
        portfolio_id: portfolioId,
        project_type: form.project_type,
        region: form.region,
        contract_value_usd: form.contract_value_usd,
        subcontractor_count: form.subcontractor_count,
        k: form.k,
      },
      nonce,
    );
  }, [fetchNonce, form, portfolioId, runSimulate]);

  const similar = useMemo(() => {
    if (!data) return [];
    return data.similar_project_ids
      .map((id) => projectsById[id] ?? null)
      .filter((p): p is SimilarProjectLookup => p !== null);
  }, [data, projectsById]);

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* Left: form. Sticky on large screens so it stays visible while
          the preview re-renders. */}
      <form
        className="flex h-fit flex-col gap-4 rounded-xl border border-border bg-card p-4 ring-1 ring-foreground/5 lg:sticky lg:top-20"
        onSubmit={(e) => {
          e.preventDefault();
          handleRetry();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="sim-project-type">Project type</Label>
          <select
            id="sim-project-type"
            value={form.project_type}
            onChange={(e) =>
              setForm((f) => ({ ...f, project_type: e.target.value }))
            }
            // WHY: native <select> ignores Tailwind on its popup; set
            // color-scheme so the OS picker adopts our dark surface, and
            // give each <option> an explicit bg/color so dark mode is
            // readable regardless of OS default.
            className="h-8 w-full rounded-lg border border-input bg-background text-foreground [color-scheme:light] dark:[color-scheme:dark] px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            {typeOptions.map((opt) => (
              <option
                key={opt}
                value={opt}
                className="bg-background text-foreground"
              >
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sim-region">Region</Label>
          <select
            id="sim-region"
            value={form.region}
            onChange={(e) =>
              setForm((f) => ({ ...f, region: e.target.value }))
            }
            className="h-8 w-full rounded-lg border border-input bg-background text-foreground [color-scheme:light] dark:[color-scheme:dark] px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            {regionOptions.map((opt) => (
              <option
                key={opt}
                value={opt}
                className="bg-background text-foreground"
              >
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sim-contract">Contract value (USD)</Label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
            >
              $
            </span>
            <Input
              id="sim-contract"
              type="number"
              min={0}
              step={100_000}
              value={form.contract_value_usd}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  contract_value_usd: Number(e.target.value) || 0,
                }))
              }
              className="pl-5"
            />
          </div>
          <p className="text-meta text-muted-foreground tabular-nums">
            {formatCurrency(form.contract_value_usd)}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sim-subs">Subcontractor count</Label>
          <Input
            id="sim-subs"
            type="number"
            min={0}
            step={1}
            value={form.subcontractor_count}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                subcontractor_count: Math.max(0, Number(e.target.value) || 0),
              }))
            }
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sim-k">Cohort size (k)</Label>
          <Input
            id="sim-k"
            type="number"
            min={1}
            max={20}
            step={1}
            value={form.k}
            onChange={(e) => {
              const raw = Number(e.target.value) || 1;
              const clamped = Math.min(20, Math.max(1, raw));
              setForm((f) => ({ ...f, k: clamped }));
            }}
          />
          <p className="text-meta text-muted-foreground">
            Nearest-neighbors pulled from this portfolio. 1–20.
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
              <Loader2 aria-hidden className="size-3 animate-spin" />
              Simulating…
            </span>
          ) : (
            <span className="text-meta text-muted-foreground">Auto-updates</span>
          )}
        </div>
      </form>

      {/* Right: preview. */}
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-h3 text-foreground">
            Likely outcomes for a similar cohort
          </h3>
          <p className="text-meta text-muted-foreground">
            Based on k-nearest-neighbor lookup in your portfolio. Treat as
            directional, not predictive.
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
          >
            <div className="flex items-center gap-2 text-body text-destructive">
              <AlertTriangle aria-hidden className="size-4" />
              <span>Could not run simulation. {error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RotateCcw aria-hidden />
              Retry
            </Button>
          </div>
        ) : null}

        {data == null && !error ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-card/30 px-4 py-6 text-meta text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading cohort…
          </div>
        ) : null}

        {data != null && data.cohort_size === 0 ? (
          <EmptyState
            title="No matching projects yet"
            description="Upload a portfolio first, or broaden the scenario — there are no nearest-neighbors to draw from."
          />
        ) : null}

        {data != null && data.cohort_size > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <OutcomeBlock
                title="Delay (days)"
                range={data.outcomes.delay_days}
                formatter={fmtDays}
              />
              <OutcomeBlock
                title="Cost overrun"
                range={data.outcomes.cost_overrun_pct}
                formatter={fmtPctRate}
              />
              <OutcomeBlock
                title="Safety incidents"
                range={data.outcomes.safety_incidents}
                formatter={formatNumber}
              />
              <DisputeBlock rate={data.outcomes.any_dispute} />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-meta text-muted-foreground">
              <span className="tabular-nums">
                Cohort size: {data.cohort_size} of {data.k_requested} requested
              </span>
              {data.cohort_size < 3 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
                  Low cohort — treat as directional
                </span>
              ) : null}
            </div>

            {data.caveats.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-meta text-muted-foreground">
                {data.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-2 flex flex-col gap-2">
              <h4 className="text-h3 text-foreground">Similar projects</h4>
              {similar.length === 0 ? (
                <p className="text-meta text-muted-foreground">
                  No matching rows found in the portfolio cache.
                </p>
              ) : (
                <ul className="space-y-2" aria-label="Similar projects">
                  {similar.map((p) => (
                    <li
                      key={p.id}
                      className={cn(
                        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-card px-3 py-2",
                      )}
                    >
                      <Link
                        href={`/portfolios/${portfolioId}/projects`}
                        className="flex min-w-0 flex-col transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
                      >
                        <span className="truncate text-body text-foreground">
                          {p.project_name ?? "—"}
                        </span>
                        <span className="font-mono text-meta text-muted-foreground">
                          {p.project_id_external ?? p.id.slice(0, 8)}
                        </span>
                      </Link>
                      <div className="flex items-center gap-4 text-meta tabular-nums text-muted-foreground">
                        <span>
                          Delay:{" "}
                          {p.delay_days != null
                            ? `${formatNumber(p.delay_days)}d`
                            : "n/a"}
                        </span>
                        <span>
                          Overrun:{" "}
                          {p.cost_overrun_pct != null
                            ? formatPercent(p.cost_overrun_pct, 1)
                            : "n/a"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// Screen (Pre-construction intake) showcase — dedicated landing-page section
// that promotes the cohort-based scenario simulator. Mirrors the real UI at
// /portfolios/[id]/screen so a reviewer can see the feature without clicking.
//
// WHY a full section instead of another ProductPillars row: the Screen tool is
// the workflow that turns the portfolio from a one-shot report into a reusable
// bidding instrument. It deserves top billing — hero-adjacent, full-width mockup,
// its own explainer copy. The mockup uses the same design tokens as the live
// page (DistributionStrip-style track, StatusDot colors, bg-card surfaces) so
// it stays honest to what the user will actually see.

import type { ReactElement } from "react";
import {
  ArrowRight,
  Gauge,
  Layers,
  Radar,
  Scale,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type OutcomeDatum = {
  title: string;
  lo: string;
  mid: string;
  hi: string;
  loPct: number; // where on the 0–100 track the lo tick sits
  midPct: number;
  hiPct: number;
  n: number;
  confidence: "low" | "medium" | "high";
};

const OUTCOMES: OutcomeDatum[] = [
  {
    title: "Delay (days)",
    lo: "5d",
    mid: "47d",
    hi: "67d",
    loPct: 4,
    midPct: 68,
    hiPct: 96,
    n: 5,
    confidence: "medium",
  },
  {
    title: "Cost overrun",
    lo: "2.1%",
    mid: "8.2%",
    hi: "13.2%",
    loPct: 6,
    midPct: 56,
    hiPct: 94,
    n: 5,
    confidence: "medium",
  },
  {
    title: "Safety incidents",
    lo: "0",
    mid: "2",
    hi: "3",
    loPct: 4,
    midPct: 66,
    hiPct: 96,
    n: 5,
    confidence: "medium",
  },
];

type SimilarProject = {
  name: string;
  id: string;
  delay: string;
  overrun: string;
};

const SIMILAR: SimilarProject[] = [
  { name: "Hospital Renovation", id: "PRJ012", delay: "67d", overrun: "13.2%" },
  { name: "Wind Farm Phase 1", id: "PRJ014", delay: "5d", overrun: "0.8%" },
  { name: "Downtown Office Tower", id: "PRJ007", delay: "42d", overrun: "7.1%" },
];

const VALUE_PROPS = [
  {
    icon: Radar,
    title: "k-nearest cohort lookup",
    body: "Pulls the most similar projects from your portfolio on every keystroke. No black-box prediction — just grounded comparables.",
  },
  {
    icon: Gauge,
    title: "P25 / P50 / P75 ranges",
    body: "Percentile bands instead of a single number. Reviewers see the spread, not a false-precision point estimate.",
  },
  {
    icon: ShieldAlert,
    title: "Confidence is earned",
    body: "Cohort sizes below three surface a warning chip. If the portfolio can't support the question, the UI says so.",
  },
  {
    icon: Scale,
    title: "95% CI on dispute rate",
    body: "Binary outcomes (disputes) report a rate with a Wilson confidence interval — not a hand-wavy probability.",
  },
];

export function ScreenShowcase(): ReactElement {
  return (
    <section
      aria-labelledby="screen-heading"
      className="relative scroll-mt-12 pb-24"
    >
      {/* Ambient backdrop — a soft primary glow that only shows through the
          card's translucent surface. Kept low-saturation so it doesn't
          compete with the dashboard UI next to it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-16 -z-10 mx-auto h-[520px] max-w-5xl bg-[radial-gradient(ellipse_at_top,var(--color-primary)/0.08,transparent_55%)]"
      />

      <header className="mb-10 max-w-3xl">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 border-primary/30 bg-primary/5 text-primary uppercase tracking-wide"
          >
            <Sparkles className="size-3" aria-hidden />
            New
          </Badge>
          <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
            Pre-construction intake
          </p>
        </div>
        <h2 id="screen-heading" className="text-h1 mt-3 text-foreground md:text-display md:max-w-2xl">
          Screen hypothetical projects against your portfolio, live.
        </h2>
        <p className="mt-4 max-w-2xl text-body text-muted-foreground">
          Type a contract value, a region, a subcontractor count — and the
          dashboard reaches into the portfolio you uploaded, pulls the k
          nearest neighbors, and shows the outcome bands that cohort actually
          ran into. Cohort-based, not predictive. Directional, honest, and
          re-usable for every new bid that comes across the desk.
        </p>
      </header>

      {/* Mockup card — 2-column on ≥ lg, stacked below. Mirrors the real
          Screen page's [360px, 1fr] grid. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft ring-1 ring-foreground/5">
        <BrowserChrome />

        <div className="grid gap-4 p-4 md:gap-5 md:p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <IntakeForm />
          <OutcomePanel />
        </div>
      </div>

      {/* Value props — a 4-up grid underneath, mirroring the "four reasons"
          pattern from top B2B landing pages (Linear, Vercel). */}
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {VALUE_PROPS.map((v) => {
          const Icon = v.icon;
          return (
            <div key={v.title} className="flex flex-col gap-2">
              <div
                className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary"
                aria-hidden
              >
                <Icon className="size-4" />
              </div>
              <h3 className="text-h3 text-foreground">{v.title}</h3>
              <p className="text-meta text-muted-foreground">{v.body}</p>
            </div>
          );
        })}
      </div>

      {/* Inline callout: how this threads into the rest of the product. */}
      <aside className="mt-10 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-5 md:flex-row md:items-center md:gap-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background text-primary">
          <Layers className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-h3 text-foreground">
            Built on the same portfolio you already uploaded.
          </p>
          <p className="text-meta text-muted-foreground">
            No separate training step. Upload a CSV once, and the Screen tool,
            the anomaly flags, and the pre-construction model all share that
            single source of truth.
          </p>
        </div>
        <a
          href="#upload"
          className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Try it with demo data
          <ArrowRight className="size-3.5" aria-hidden />
        </a>
      </aside>
    </section>
  );
}

/* ── Mockup sub-components ─────────────────────────────────────────────── */

function BrowserChrome(): ReactElement {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-muted-foreground/25" />
        <span className="size-2.5 rounded-full bg-muted-foreground/25" />
        <span className="size-2.5 rounded-full bg-muted-foreground/25" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">
          enlaye.com / portfolios / projects.csv / <span className="text-foreground">screen</span>
        </span>
      </div>
      <span className="hidden text-[11px] text-muted-foreground md:inline">
        Auto-updates
      </span>
    </div>
  );
}

function IntakeForm(): ReactElement {
  return (
    <div className="flex h-fit flex-col gap-4 rounded-xl border border-border bg-background p-4 ring-1 ring-foreground/5">
      <FieldSelect label="Project type" value="Commercial" />
      <FieldSelect label="Region" value="Midwest" />
      <FieldInput
        label="Contract value (USD)"
        value="30000000"
        prefix="$"
        hint="$30M"
      />
      <FieldInput label="Subcontractor count" value="10" />
      <FieldInput
        label="Cohort size (k)"
        value="5"
        hint="Nearest-neighbors pulled from this portfolio. 1–20."
      />
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-meta text-muted-foreground">Auto-updates</span>
        <span
          className="inline-flex items-center gap-1.5 text-meta text-primary"
          aria-live="polite"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Live
        </span>
      </div>
    </div>
  );
}

function FieldSelect({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-foreground">{label}</span>
      <div className="flex h-8 items-center justify-between rounded-lg border border-input bg-background px-2.5 text-sm text-foreground">
        <span>{value}</span>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="size-3.5 text-muted-foreground"
        >
          <path
            d="M5 7l5 6 5-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  prefix,
  hint,
}: {
  label: string;
  value: string;
  prefix?: string;
  hint?: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-foreground">{label}</span>
      <div className="relative">
        {prefix ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {prefix}
          </span>
        ) : null}
        <div
          className={cn(
            "flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-sm text-foreground tabular-nums",
            prefix && "pl-5",
          )}
        >
          {value}
        </div>
      </div>
      {hint ? (
        <p className="text-meta text-muted-foreground tabular-nums">{hint}</p>
      ) : null}
    </div>
  );
}

function OutcomePanel(): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h3 className="text-h3 text-foreground">
          Likely outcomes for a similar cohort
        </h3>
        <p className="text-meta text-muted-foreground">
          Based on k-nearest-neighbor lookup in your portfolio. Treat as
          directional, not predictive.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {OUTCOMES.map((o) => (
          <OutcomeCard key={o.title} outcome={o} />
        ))}
        <DisputeCard />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-meta text-muted-foreground">
        <span className="tabular-nums">Cohort size: 5 of 5 requested</span>
      </div>

      <div className="mt-1 flex min-w-0 flex-col gap-2">
        <h4 className="text-h3 text-foreground">Similar projects</h4>
        <ul className="space-y-2" aria-label="Similar projects">
          {SIMILAR.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-body text-foreground">
                  {p.name}
                </span>
                <span className="font-mono text-meta text-muted-foreground">
                  {p.id}
                </span>
              </div>
              <div className="flex items-center gap-4 text-meta tabular-nums text-muted-foreground">
                <span>Delay: {p.delay}</span>
                <span>Overrun: {p.overrun}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OutcomeCard({ outcome }: { outcome: OutcomeDatum }): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3">
      <p className="text-meta uppercase tracking-wide text-muted-foreground">
        {outcome.title}
      </p>

      {/* Track + ticks + dot. Matches DistributionStrip's geometry so the
          mockup reads as the same component readers will see live. */}
      <div className="flex flex-col gap-1">
        <div className="relative h-2.5 w-full">
          <div
            className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/30"
            aria-hidden
          />
          <div
            className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/70"
            style={{ left: `calc(${outcome.loPct}% - 1px)` }}
            aria-hidden
          />
          <div
            className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/70"
            style={{ left: `calc(${outcome.hiPct}% - 1px)` }}
            aria-hidden
          />
          <div
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
            style={{ left: `${outcome.midPct}%` }}
            aria-hidden
          />
        </div>
        <div className="relative h-4 w-full text-meta text-muted-foreground">
          <span
            className="absolute tabular-nums"
            style={{ left: `${outcome.loPct}%`, transform: "translateX(-50%)" }}
          >
            {outcome.lo}
          </span>
          <span
            className="absolute tabular-nums text-foreground"
            style={{
              left: `${outcome.midPct}%`,
              transform: "translateX(-50%)",
            }}
          >
            {outcome.mid}
          </span>
          <span
            className="absolute tabular-nums"
            style={{ left: `${outcome.hiPct}%`, transform: "translateX(-50%)" }}
          >
            {outcome.hi}
          </span>
        </div>
      </div>

      <p className="text-meta text-muted-foreground">
        n={outcome.n} · P25 / P50 / P75
      </p>
      <ConfidenceDot tone={outcome.confidence} n={outcome.n} />
    </div>
  );
}

function DisputeCard(): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3">
      <p className="text-meta uppercase tracking-wide text-muted-foreground">
        Dispute likelihood
      </p>
      <p className="text-h2 tabular-nums text-foreground">60%</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
        <span className="tabular-nums">95% CI 23%–88%</span>
        <span className="tabular-nums">n=5</span>
      </div>
      <ConfidenceDot tone="medium" n={5} />
    </div>
  );
}

function ConfidenceDot({
  tone,
  n,
}: {
  tone: "low" | "medium" | "high";
  n: number;
}): ReactElement {
  const map = {
    low: { color: "bg-warning", label: "Low confidence" },
    medium: { color: "bg-info", label: "Medium confidence" },
    high: { color: "bg-success", label: "High confidence" },
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
      <span className="tabular-nums">n={n}</span>
      <span className={cn("size-1.5 rounded-full", map.color)} aria-hidden />
      <span>{map.label}</span>
    </span>
  );
}

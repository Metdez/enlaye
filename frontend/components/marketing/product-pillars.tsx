// Product pillars — three alternating explainer blocks, each paired with a
// tight inline UI mockup. Text on one side, mockup on the other; alternates
// on ≥ md so the reader's eye zig-zags down the page instead of scanning a
// straight column.
//
// WHY inline mockups instead of screenshot files: real product screenshots
// would be better (rule §9) but we don't want a separate asset pipeline for
// one marketing page. These mockups pull from the same tokens the dashboard
// uses, so they stay honest to the actual UI.

import type { ReactElement, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, MessageSquare, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

type Pillar = {
  eyebrow: string;
  title: string;
  body: string;
  details: string[];
  mockup: ReactNode;
};

const PILLARS: Pillar[] = [
  {
    eyebrow: "Ingest",
    title: "Clean the data before anyone trusts it.",
    body:
      "A CSV of projects lands, we coerce types, median-impute the completed rows, and log every change so you can see exactly what we touched.",
    details: [
      "Median imputation — construction data has outliers; means would lie.",
      "Type coercion on numerics and dates with a per-run report.",
      "Four threshold anomalies: cost overrun > 25%, delay > 150 d, safety ≥ 5, disputes ≥ 5.",
      "Raw file stashed in Supabase Storage for replay; portfolios are append-only.",
    ],
    mockup: <CleaningMockup />,
  },
  {
    eyebrow: "Model",
    title: "Two models, side by side — to show what leakage looks like.",
    body:
      "A naive model trains on every column and scores near 100% on this tiny training set. A second model trains only on what you know at bid time. The gap is the point.",
    details: [
      "Naive: logistic regression over all numerics + one-hot type/region.",
      "Pre-construction: project_type, contract_value_usd, region, subcontractor_count.",
      "Feature importance bars surface leaky features in rose; bid-time features in emerald.",
      "Training accuracy is reported as training accuracy — not a performance claim.",
    ],
    mockup: <ModelsMockup />,
  },
  {
    eyebrow: "Ask",
    title: "Chat with your project documents, cited.",
    body:
      "Upload PDFs, DOCX, or TXT. They're chunked at ~400 tokens, embedded with gte-small into pgvector, and retrieved for each question. Answers carry inline citations back to the source chunks.",
    details: [
      "Embeddings: 384-dim gte-small via Supabase.ai on Edge Functions.",
      "Retrieval: cosine similarity with tunable top_k and threshold.",
      "Generation: DeepSeek v3.2 via OpenRouter, prompted to cite or abstain.",
      "Confidence is derived from the top similarity score, not vibes.",
    ],
    mockup: <ChatMockup />,
  },
];

export function ProductPillars(): ReactElement {
  return (
    <section aria-labelledby="pillars-heading" className="space-y-16 pb-20">
      <header className="max-w-2xl">
        <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          What Enlaye does
        </p>
        <h2 id="pillars-heading" className="text-h1 mt-2 text-foreground">
          Three jobs, done deliberately.
        </h2>
        <p className="mt-3 text-body text-muted-foreground">
          Portfolio cleaning, a deliberately leaky-vs-clean model comparison,
          and a small RAG chat over uploaded project documents. Each is scoped
          tight so you can reason about what the system knows and what it's
          guessing.
        </p>
      </header>

      <div className="space-y-16">
        {PILLARS.map((p, i) => (
          <PillarRow key={p.title} pillar={p} reverse={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}

function PillarRow({
  pillar,
  reverse,
}: {
  pillar: Pillar;
  reverse: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        "grid gap-10 md:grid-cols-2 md:items-center md:gap-16",
        reverse && "md:[&>*:first-child]:order-2",
      )}
    >
      <div>
        <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          {pillar.eyebrow}
        </p>
        <h3 className="text-h1 mt-2 max-w-xl text-foreground">{pillar.title}</h3>
        <p className="mt-4 text-body text-muted-foreground">{pillar.body}</p>
        <ul className="mt-5 space-y-2.5">
          {pillar.details.map((d) => (
            <li key={d} className="flex gap-3 text-body text-foreground/90">
              <CheckCircle2
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span className="text-muted-foreground">{d}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">{pillar.mockup}</div>
    </div>
  );
}

/* ── Mockups ───────────────────────────────────────────────────────────── */

function MockupFrame({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2">
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function CleaningMockup(): ReactElement {
  return (
    <MockupFrame>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-h3 text-foreground">Cleaning report</p>
          <span className="text-meta tabular-nums">15 rows · 5 flagged</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-meta">
          <Stat label="Imputed" value="3" />
          <Stat label="Coerced" value="7" />
          <Stat label="Rejected" value="0" />
        </div>
        <ul className="space-y-1.5 text-meta">
          <FlagRow tone="cost" label="PRJ003 · cost overrun 32.1%" hint="threshold 25%" />
          <FlagRow tone="delay" label="PRJ006 · 187 days delay" hint="threshold 150" />
          <FlagRow tone="safety" label="PRJ011 · 6 safety incidents" hint="threshold 5" />
        </ul>
      </div>
    </MockupFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function FlagRow({
  tone,
  label,
  hint,
}: {
  tone: "cost" | "delay" | "safety";
  label: string;
  hint: string;
}): ReactElement {
  const dotClass = {
    cost: "bg-[color:var(--anomaly-cost)]",
    delay: "bg-[color:var(--anomaly-delay)]",
    safety: "bg-[color:var(--anomaly-safety)]",
  }[tone];
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2">
        <AlertTriangle aria-hidden className="size-3 text-muted-foreground" />
        <span className={cn("size-1.5 rounded-full", dotClass)} aria-hidden />
        <span className="truncate text-foreground">{label}</span>
      </span>
      <span className="shrink-0 text-muted-foreground">{hint}</span>
    </li>
  );
}

function ModelsMockup(): ReactElement {
  const naiveBars = [
    { label: "delay_days", pct: 92, leaky: true },
    { label: "payment_disputes", pct: 78, leaky: true },
    { label: "cost_overrun_pct", pct: 61, leaky: true },
    { label: "subcontractor_count", pct: 28, leaky: false },
  ];
  const preBars = [
    { label: "contract_value_usd", pct: 74 },
    { label: "project_type: Infra.", pct: 58 },
    { label: "subcontractor_count", pct: 41 },
    { label: "region: Northeast", pct: 22 },
  ];
  return (
    <MockupFrame>
      <div className="grid gap-3 sm:grid-cols-2">
        <ModelCard
          title="Naive"
          accuracy="100%"
          caveat="Uses features that don't exist at bid time."
          tone="danger"
        >
          {naiveBars.map((b) => (
            <Bar
              key={b.label}
              label={b.label}
              pct={b.pct}
              tone={b.leaky ? "leaky" : "neutral"}
            />
          ))}
        </ModelCard>
        <ModelCard
          title="Pre-construction"
          accuracy="67%"
          caveat="Only bid-time inputs — usable now."
          tone="success"
        >
          {preBars.map((b) => (
            <Bar key={b.label} label={b.label} pct={b.pct} tone="actionable" />
          ))}
        </ModelCard>
      </div>
    </MockupFrame>
  );
}

function ModelCard({
  title,
  accuracy,
  caveat,
  tone,
  children,
}: {
  title: string;
  accuracy: string;
  caveat: string;
  tone: "danger" | "success";
  children: ReactNode;
}): ReactElement {
  const borderClass =
    tone === "danger" ? "border-destructive/30" : "border-success/30";
  const labelClass = tone === "danger" ? "text-destructive" : "text-success";
  return (
    <div className={cn("rounded-md border bg-background/40 p-3", borderClass)}>
      <p className={cn("text-[10px] font-medium uppercase tracking-wide", labelClass)}>
        {title}
      </p>
      <p className="mt-1 font-mono text-xl tabular-nums text-foreground">
        {accuracy}
      </p>
      <p className="mb-3 text-[11px] text-muted-foreground">{caveat}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Bar({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: "leaky" | "actionable" | "neutral";
}): ReactElement {
  const barClass = {
    leaky: "bg-destructive/80",
    actionable: "bg-success/80",
    neutral: "bg-muted-foreground/40",
  }[tone];
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
      <div className="flex items-center gap-2">
        <span className="w-28 truncate text-[11px] text-muted-foreground">
          {label}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", barClass)}
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>
      </div>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
        {pct}
      </span>
    </div>
  );
}

function ChatMockup(): ReactElement {
  return (
    <MockupFrame>
      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 text-[13px] leading-snug text-primary-foreground">
            What risks did we flag on Harbor Bridge Expansion?
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Sparkles className="size-3" aria-hidden />
          </div>
          <div className="max-w-[85%] space-y-2">
            <div className="rounded-lg bg-muted px-3 py-2 text-[13px] leading-snug text-foreground">
              Harbor Bridge Expansion ran 47 days over schedule
              <Cite n={1} /> with a cost overrun of 8.2% and two safety incidents
              <Cite n={2} />. Change orders totaled $1.3M across three line items.
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <MessageSquare className="size-3" aria-hidden />
              <span>2 sources · confidence high · 0.82</span>
            </div>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

function Cite({ n }: { n: number }): ReactElement {
  return (
    <span className="mx-0.5 inline-flex items-center rounded-sm bg-sidebar-accent px-1 font-mono text-[10px] text-sidebar-accent-foreground">
      C{n}
    </span>
  );
}

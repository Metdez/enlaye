// Architecture diagram — three-column data flow showing how a request
// travels from the browser through Supabase and out to the Python ML
// service / OpenRouter. Drawn entirely in CSS so it lives in the theme
// and stays crisp at any zoom.

import type { ReactElement, ReactNode } from "react";
import {
  ArrowRight,
  Boxes,
  Cpu,
  Database,
  Globe,
  Network,
  Sparkles,
} from "lucide-react";

type Node = {
  icon: typeof Globe;
  title: string;
  role: string;
  detail: string[];
};

const STAGE_1: Node = {
  icon: Globe,
  title: "Browser",
  role: "Next.js 15 · React 19",
  detail: [
    "App Router, server components first.",
    "Dropzone + client islands for uploads and chat.",
    "Direct reads from Supabase via anon key (demo).",
  ],
};

const STAGE_2: Node[] = [
  {
    icon: Database,
    title: "Supabase Postgres",
    role: "Data of record",
    detail: [
      "portfolios, projects, model_runs, documents, document_chunks.",
      "pgvector (384-dim) for chunk embeddings.",
      "pg_net + trigger fires the embed webhook.",
    ],
  },
  {
    icon: Boxes,
    title: "Supabase Storage",
    role: "Raw files",
    detail: [
      "portfolios-uploads (10 MB) for CSVs.",
      "documents-bucket (25 MB) for PDFs/DOCX/TXT.",
      "Canonical path: portfolios/<id>/raw.csv.",
    ],
  },
  {
    icon: Network,
    title: "Edge Functions (Deno)",
    role: "embed · query",
    detail: [
      "embed: extract → chunk (~400 tok / 50 overlap) → gte-small.",
      "query: embed question → similarity search → prompt DeepSeek.",
      "JWT-gated on query; internal webhook on embed.",
    ],
  },
];

const STAGE_3: Node[] = [
  {
    icon: Cpu,
    title: "Python ML service",
    role: "FastAPI on Railway",
    detail: [
      "/ingest: cleaning + anomaly flags + projects insert.",
      "/train: two logistic regressions written to model_runs.",
      "Service-role Supabase client; bearer-token'd behind /api/ml proxy.",
    ],
  },
  {
    icon: Sparkles,
    title: "DeepSeek v3.2",
    role: "via OpenRouter",
    detail: [
      "Prompted to cite sources as [C1], [C2] or abstain.",
      "temperature 0.2 · 25s timeout · HTTP-Referer attribution.",
      "Model id configurable through an Edge Function secret.",
    ],
  },
];

export function ArchitectureDiagram(): ReactElement {
  return (
    <section aria-labelledby="arch-heading" className="pb-20">
      <header className="max-w-2xl">
        <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          Under the hood
        </p>
        <h2 id="arch-heading" className="text-h1 mt-2 text-foreground">
          Data flow, end to end.
        </h2>
        <p className="mt-3 text-body text-muted-foreground">
          No magic. A short path from the browser to Postgres, a pair of Edge
          Functions for embedding and retrieval, and a small Python service
          carrying the two scikit-learn models. Every boundary is typed and
          allowlisted.
        </p>
      </header>

      <div className="mt-10 grid gap-6 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
        <Stage label="1 · Client">
          <NodeCard node={STAGE_1} />
        </Stage>
        <FlowArrow />
        <Stage label="2 · Supabase Cloud">
          {STAGE_2.map((n) => (
            <NodeCard key={n.title} node={n} />
          ))}
        </Stage>
        <FlowArrow />
        <Stage label="3 · Compute & LLM">
          {STAGE_3.map((n) => (
            <NodeCard key={n.title} node={n} />
          ))}
        </Stage>
      </div>

      <p className="mt-6 text-meta text-muted-foreground">
        Secrets never touch the browser. INTERNAL_API_TOKEN is stamped into the
        Next.js /api/ml/* proxy on the server; OPENROUTER_API_KEY lives only as
        a Supabase Edge Function secret.
      </p>
    </section>
  );
}

function Stage({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
    </div>
  );
}

function FlowArrow(): ReactElement {
  return (
    <div
      className="flex items-center justify-center py-3 text-muted-foreground md:py-0"
      aria-hidden
    >
      <ArrowRight className="size-5 md:rotate-0" />
    </div>
  );
}

function NodeCard({ node }: { node: Node }): ReactElement {
  const Icon = node.icon;
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-h3 text-foreground">{node.title}</p>
          <p className="text-[11px] text-muted-foreground">{node.role}</p>
        </div>
      </div>
      <ul className="space-y-1 text-[12px] leading-snug text-muted-foreground">
        {node.detail.map((d) => (
          <li key={d} className="flex gap-1.5">
            <span aria-hidden className="shrink-0 text-primary/60">·</span>
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

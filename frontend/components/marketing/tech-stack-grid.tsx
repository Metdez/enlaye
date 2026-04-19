// Tech stack grid — grouped by layer so a reviewer can scan who's doing
// what. Data is literal (pulled from package.json, requirements.txt, and
// ARCHITECTURE.md) so it doesn't drift into marketing fiction.

import type { ReactElement } from "react";

type Layer = {
  label: string;
  blurb: string;
  items: Array<{ name: string; role: string }>;
};

const LAYERS: Layer[] = [
  {
    label: "Frontend",
    blurb: "Typed, server-first, no CSS-in-JS runtime.",
    items: [
      { name: "Next.js 15", role: "App Router, RSC, Turbopack builds" },
      { name: "React 19", role: "Server components + client islands" },
      { name: "TypeScript", role: "strict mode, zero any" },
      { name: "Tailwind 4", role: "@theme tokens, zero-runtime" },
      { name: "shadcn/ui (base-nova)", role: "Base UI primitives" },
      { name: "Geist", role: "single sans family via next/font" },
      { name: "Recharts", role: "bar + donut charts" },
      { name: "lucide-react", role: "icon library (one only)" },
      { name: "Sonner", role: "toast feedback" },
      { name: "next-themes", role: "dark-mode class toggle" },
      { name: "react-dropzone", role: "CSV + document upload" },
    ],
  },
  {
    label: "Backend / ML",
    blurb: "A small Python service doing one job well.",
    items: [
      { name: "Python 3.11", role: "runtime" },
      { name: "FastAPI", role: "/health · /ingest · /train" },
      { name: "uvicorn", role: "ASGI server" },
      { name: "pandas", role: "CSV parse + cleaning" },
      { name: "scikit-learn", role: "logistic regression (x2)" },
      { name: "pypdf", role: "PDF text extraction" },
      { name: "mammoth", role: "DOCX → plain text (in Edge Function)" },
    ],
  },
  {
    label: "Data & AI",
    blurb: "One Postgres, two models, cited answers.",
    items: [
      { name: "Supabase Postgres", role: "projects · documents · model_runs" },
      { name: "pgvector 384-dim", role: "ivfflat cosine index" },
      { name: "gte-small", role: "Supabase.ai embedding model" },
      { name: "DeepSeek v3.2", role: "answer generation" },
      { name: "OpenRouter", role: "LLM gateway, server-side only" },
      { name: "pg_net", role: "DB webhook → embed function" },
    ],
  },
  {
    label: "Infra",
    blurb: "Deployed from the CLI, nothing clicked in a dashboard.",
    items: [
      { name: "Vercel", role: "frontend deploys" },
      { name: "Railway", role: "ML service container" },
      { name: "Supabase Cloud", role: "DB + Storage + Edge Functions" },
      { name: "GitHub", role: "repo + Actions (future)" },
    ],
  },
];

export function TechStackGrid(): ReactElement {
  return (
    <section aria-labelledby="stack-heading" className="pb-20">
      <header className="max-w-2xl">
        <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          Built on
        </p>
        <h2 id="stack-heading" className="text-h1 mt-2 text-foreground">
          Boring tools, used carefully.
        </h2>
        <p className="mt-3 text-body text-muted-foreground">
          Every dependency earns its seat. Nothing here is speculative; each
          piece maps to a file in the repo.
        </p>
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {LAYERS.map((layer) => (
          <LayerCard key={layer.label} layer={layer} />
        ))}
      </div>
    </section>
  );
}

function LayerCard({ layer }: { layer: Layer }): ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-h3 text-foreground">{layer.label}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{layer.blurb}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {layer.items.length}
        </span>
      </div>
      <ul className="space-y-2">
        {layer.items.map((item) => (
          <li
            key={item.name}
            className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2 last:border-b-0 last:pb-0"
          >
            <span className="truncate text-[13px] font-medium text-foreground">
              {item.name}
            </span>
            <span className="shrink-0 text-right text-[12px] text-muted-foreground">
              {item.role}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

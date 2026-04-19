// Landing page — hero + upload + how-it-works + product pillars +
// architecture diagram + tech stack + known limits + recent portfolios.
// WHY: server component; fetches recent portfolios on the server so the list
// is part of the initial HTML. CsvUpload is a client leaf that handles the
// interactive upload/demo flow and redirects to `/portfolios/[id]` when done.
// Marketing sections are static server components to keep the client bundle
// lean — nothing on this page except CsvUpload ships JavaScript.

import type { ReactElement } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  GitBranch,
  MessageSquare,
  Sparkles,
  Upload,
} from "lucide-react";

import { CsvUpload } from "@/components/features/csv-upload";
import { RecentPortfolios } from "@/components/features/recent-portfolios";
import { ArchitectureDiagram } from "@/components/marketing/architecture-diagram";
import { KnownLimits } from "@/components/marketing/known-limits";
import { ProductPillars } from "@/components/marketing/product-pillars";
import { TechStackGrid } from "@/components/marketing/tech-stack-grid";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createServerSupabase } from "@/lib/supabase";
import type { Portfolio } from "@/lib/types";

export const dynamic = "force-dynamic";
// WHY: recent-portfolios must reflect the just-completed upload flow; any
// caching here defeats the "I just uploaded, where did it go?" feedback.
export const revalidate = 0;

async function fetchRecentPortfolios(): Promise<Portfolio[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("portfolios")
    .select("id, name, row_count, anomaly_count, cleaning_report, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  return (data as Portfolio[] | null) ?? [];
}

type HowItWorksStep = {
  icon: typeof Upload;
  title: string;
  body: string;
};

const STEPS: HowItWorksStep[] = [
  {
    icon: Upload,
    title: "Upload CSV",
    body: "Drop a project portfolio. We validate required columns and stash the raw file in Storage.",
  },
  {
    icon: Sparkles,
    title: "Clean & flag",
    body: "Median imputation, type coercion, and threshold-based anomaly flags — documented per run.",
  },
  {
    icon: BarChart3,
    title: "Train & ask",
    body: "Two dispute-risk models compare side-by-side. Ask questions over uploaded project documents.",
  },
];

export default async function Home(): Promise<ReactElement> {
  const portfolios = await fetchRecentPortfolios();

  return (
    <div className="mx-auto w-full max-w-6xl px-6">
      {/* Hero */}
      <section className="flex flex-col items-center gap-5 py-20 text-center md:py-28">
        <Badge variant="outline" className="uppercase tracking-wide">
          Construction risk · demo
        </Badge>
        <h1 className="text-display max-w-3xl text-foreground">
          See risk before the first shovel.
        </h1>
        <p className="text-body mx-auto max-w-xl text-muted-foreground">
          Upload a portfolio CSV. Enlaye cleans the data, flags anomalies,
          compares two dispute-risk models, and answers questions over your
          project documents.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#upload"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Try with demo data
            <ArrowRight className="size-3.5" aria-hidden />
          </a>
          <a
            href="#pillars"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            See how it works
          </a>
        </div>
        <p className="mt-6 max-w-xl text-[12px] text-muted-foreground">
          Originally scoped as a 120-minute internship assessment, now built out
          as the product that brief was pointing at.
        </p>
      </section>

      {/* Upload */}
      <section
        id="upload"
        aria-label="Upload a portfolio"
        className="scroll-mt-12 pb-20"
      >
        <Card className="p-6 md:p-8">
          <CsvUpload />
        </Card>
      </section>

      {/* How it works (user flow, 3 steps) */}
      <section aria-labelledby="how-heading" className="pb-20">
        <div className="mb-8 max-w-2xl">
          <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
            User flow
          </p>
          <h2 id="how-heading" className="text-h1 mt-2 text-foreground">
            Three steps from CSV to insight.
          </h2>
          <p className="mt-3 text-body text-muted-foreground">
            Everything a reviewer needs to see happens in two clicks and one
            paste of a question.
          </p>
        </div>
        <ol className="grid list-none gap-4 p-0 md:grid-cols-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <Card className="h-full p-5">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground"
                        aria-hidden
                      >
                        <Icon className="size-4" />
                      </div>
                      <span className="text-meta tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="text-h3 text-foreground">{step.title}</h3>
                    <p className="text-body text-muted-foreground">
                      {step.body}
                    </p>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Product pillars (what it does, with inline UI mockups) */}
      <div id="pillars" className="scroll-mt-12">
        <ProductPillars />
      </div>

      {/* Architecture diagram */}
      <ArchitectureDiagram />

      {/* Tech stack grid */}
      <TechStackGrid />

      {/* Known limits */}
      <KnownLimits />

      {/* Recent portfolios */}
      <section aria-labelledby="recent-heading" className="pb-20">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
              Live data
            </p>
            <h2 id="recent-heading" className="text-h1 mt-2 text-foreground">
              Recent portfolios
            </h2>
          </div>
          {portfolios.length > 0 ? (
            <p className="text-meta">Latest {portfolios.length}</p>
          ) : null}
        </div>
        {portfolios.length === 0 ? (
          <p className="text-body text-muted-foreground">
            New here? Upload your first portfolio above.
          </p>
        ) : (
          <RecentPortfolios portfolios={portfolios} />
        )}
      </section>

      <Footer />
    </div>
  );
}

function Footer(): ReactElement {
  return (
    <footer className="flex flex-col gap-4 border-t border-border py-8 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2">
        <MessageSquare className="size-3.5 text-muted-foreground" aria-hidden />
        <p className="text-meta">
          Built with Next.js, Supabase, DeepSeek · enlaye.com
        </p>
      </div>
      <div className="flex items-center gap-4 text-meta">
        <Link
          href="https://github.com/Metdez/enlaye"
          className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <GitBranch className="size-3.5" aria-hidden />
          <span>github.com/Metdez/enlaye</span>
        </Link>
      </div>
    </footer>
  );
}

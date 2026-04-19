// Portfolio layout — fetches the portfolio name once for the whole
// /portfolios/[id]/** subtree and renders the dashboard shell around it.
// WHY: the shell (sidebar, topbar, breadcrumb) is identical across
// Overview / Projects / Anomalies / Models / Documents / Ask. Putting
// it at the layout level means route transitions between those pages
// do not re-mount the shell — only the `children` slot swaps.

import { notFound } from "next/navigation";
import type { ReactElement, ReactNode } from "react";

import { PortfolioShell } from "@/components/shell/portfolio-shell";
import type { BreadcrumbItem } from "@/components/shell/breadcrumb";
import { createServerSupabase } from "@/lib/supabase";

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

// NOTE: server layouts in the App Router re-run on every request by
// default; we do not mark this `dynamic`/`static` — `createServerSupabase`
// reads cookies, which already opts us into dynamic rendering.

export default async function PortfolioLayout({
  children,
  params,
}: LayoutProps): Promise<ReactElement> {
  const { id } = await params;

  const supabase = await createServerSupabase();
  // WHY: we only need name here. Counts, cleaning report, etc. belong
  // to individual pages — pulling them into the layout would force a
  // re-fetch on every route transition.
  const { data: portfolio, error } = await supabase
    .from("portfolios")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // SECURITY: surface a 404 rather than leaking the database error
    // shape. The real error has already been logged by Supabase's
    // client on the server.
    notFound();
  }
  if (!portfolio) notFound();

  const breadcrumb: BreadcrumbItem[] = [
    { label: "Home", href: "/" },
    { label: portfolio.name },
  ];

  return (
    <PortfolioShell
      portfolioId={portfolio.id}
      portfolioName={portfolio.name}
      breadcrumb={breadcrumb}
    >
      {children}
    </PortfolioShell>
  );
}

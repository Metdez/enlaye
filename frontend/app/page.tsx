// Landing page — upload surface + recent portfolios list.
// WHY: server component wrapper keeps the recent-portfolios fetch on the
// server (fast, no client JS for the list). Interactive upload lives in the
// [CsvUpload](../components/csv-upload.tsx) client component.

import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase";
import type { Portfolio } from "@/lib/types";
import { CsvUpload } from "@/components/csv-upload";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
});

async function fetchRecentPortfolios(): Promise<{
  rows: Portfolio[];
  error: string | null;
}> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name, row_count, anomaly_count, cleaning_report, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  return {
    rows: (data as Portfolio[] | null) ?? [],
    error: error?.message ?? null,
  };
}

export default async function Home() {
  const { rows, error } = await fetchRecentPortfolios();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Enlaye — Construction Risk Dashboard
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Upload a portfolio CSV to clean, score, and explore it.
        </p>
      </header>

      <section className="mb-12">
        <CsvUpload />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Recent portfolios
        </h2>
        {error ? (
          <p className="text-sm text-red-600">Could not load portfolios: {error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No portfolios yet — upload your first CSV above.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/portfolios/${p.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {p.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {dateFormatter.format(new Date(p.created_at))}
                    </p>
                  </div>
                  <div className="shrink-0 text-xs tabular-nums text-zinc-500">
                    {p.row_count} rows · {p.anomaly_count} anomalies
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

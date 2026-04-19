// Landing page — upload surface + recent portfolios list.
// WHY: server component wrapper keeps the recent-portfolios fetch on the
// server (fast, no client JS for the list). Interactive upload lives in the
// [CsvUpload](../components/csv-upload.tsx) client component, which is
// dynamically imported below so react-dropzone is not in the initial JS
// payload — it loads in parallel after the server-rendered HTML hydrates.

import Link from "next/link";
import nextDynamic from "next/dynamic";
import { createServerSupabase } from "@/lib/supabase";
import type { Portfolio } from "@/lib/types";

// WHY: dynamic import keeps react-dropzone (~30 kB gz) out of the entry
// chunk. The dropzone is the page's primary CTA but renders fine without
// JS until the user interacts; ssr:true preserves the server-rendered
// markup for users on slow connections / no-JS readers.
const CsvUpload = nextDynamic(
  () => import("@/components/csv-upload").then((m) => m.CsvUpload),
  {
    ssr: true,
    loading: () => (
      <div
        className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700"
        aria-busy="true"
      >
        Loading uploader…
      </div>
    ),
  },
);

// WHY: data freshness — `force-dynamic` ensures we never serve a stale
// recent-portfolios list after a successful upload.
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const isEmpty = !error && rows.length === 0;

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

      {/* WHY: first-run empty state. New visitors with zero portfolios get a
          one-sentence pitch + a clear "no data? try the demo" nudge. The
          dropzone itself renders the demo button, so we just point at it. */}
      {isEmpty ? (
        <section
          aria-labelledby="empty-state-heading"
          className="mb-8 rounded-lg border border-zinc-200 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40"
        >
          <h2
            id="empty-state-heading"
            className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            New here?
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            This app cleans a CSV of construction projects, flags anomalies, and
            scores dispute risk. Drop a file below — or click{" "}
            <span className="font-medium">Load demo data</span> to try it with a
            sample portfolio.
          </p>
        </section>
      ) : null}

      <section className="mb-12" aria-label="Upload a portfolio CSV">
        <CsvUpload />
      </section>

      <section aria-labelledby="recent-portfolios-heading">
        <h2
          id="recent-portfolios-heading"
          className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500"
        >
          Recent portfolios
        </h2>
        {error ? (
          <p className="text-sm text-red-600" role="alert">
            Could not load portfolios: {error}
          </p>
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
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-zinc-900/60"
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

// Phase 1 landing: proves the frontend can read from Postgres + reach the
// ML service health endpoint through the proxy. Real upload UI lands in Phase 2.

import { headers } from "next/headers";
import { createServerSupabase } from "@/lib/supabase";
import type { Portfolio } from "@/lib/types";

export const dynamic = "force-dynamic";

type HealthResponse = {
  status?: string;
  version?: string;
  db_reachable?: boolean;
};

async function fetchMlHealth(): Promise<{ ok: boolean; body: HealthResponse | string }> {
  // WHY: derive the origin from request headers so this works on Vercel
  // (and any reverse-proxy) without an explicit NEXT_PUBLIC_APP_URL env var.
  // A hardcoded localhost fallback would silently break in production.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (!host) {
    return { ok: false, body: "Cannot resolve request origin from headers" };
  }
  const base = `${proto}://${host}`;
  try {
    const res = await fetch(`${base}/api/ml/health`, { cache: "no-store" });
    const text = await res.text();
    try {
      return { ok: res.ok, body: JSON.parse(text) as HealthResponse };
    } catch {
      return { ok: res.ok, body: text };
    }
  } catch (err) {
    return { ok: false, body: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchPortfolios(): Promise<{
  rows: Portfolio[] | null;
  error: string | null;
}> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name, row_count, anomaly_count, cleaning_report, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  return {
    rows: (data as Portfolio[] | null) ?? null,
    error: error?.message ?? null,
  };
}

export default async function Home() {
  const [{ rows, error }, health] = await Promise.all([
    fetchPortfolios(),
    fetchMlHealth(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">
          Enlaye — Construction Risk Dashboard
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Phase 1 wiring check. Upload + dashboard UI comes in Phase 2.
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Supabase — portfolios
        </h2>
        {error ? (
          <p className="text-sm text-red-600">DB read failed: {error}</p>
        ) : rows && rows.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {rows.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.name}</span>
                <span className="text-zinc-500">
                  {p.row_count} rows · {p.anomaly_count} anomalies
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">
            Connected — 0 portfolios yet. (This is the expected Phase 1 state.)
          </p>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
          ML service — /health
        </h2>
        <pre className="overflow-auto rounded bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
          {JSON.stringify({ ok: health.ok, body: health.body }, null, 2)}
        </pre>
      </section>
    </main>
  );
}

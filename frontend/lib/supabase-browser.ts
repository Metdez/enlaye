// Browser-side Supabase client factory.
// WHY: kept in its own module so client components don't transitively
// import `next/headers` via [supabase.ts](./supabase.ts) — doing so breaks
// the client bundle compile under Next.js 16 / Turbopack.

import { createBrowserClient } from "@supabase/ssr";

// NOTE: only NEXT_PUBLIC_* vars are readable in client bundles. Missing
// values are a deploy misconfig, not a runtime fallback — fail loudly.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Derive frontend/.env.local from the root .env before running.",
  );
}

/** Browser-safe client. Anon key only. */
export function createBrowserSupabase() {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
}

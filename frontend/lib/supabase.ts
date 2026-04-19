// Supabase client factories for the frontend.
// WHY: Next.js App Router has three execution contexts — browser, server
// components, and route handlers — and @supabase/ssr wants a per-request
// cookie adapter on the server. Expose two factories rather than a
// singleton so we never accidentally share cookies or credentials across
// requests.

import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

/** Server client for App Router server components / route handlers. */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        // WHY: Server Components cannot mutate cookies. This throws in RSC
        // and is a no-op there; route handlers / server actions set cookies
        // normally. The try/catch mirrors the @supabase/ssr example.
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* RSC — ignore */
        }
      },
    },
  });
}

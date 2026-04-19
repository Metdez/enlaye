// Server-side proxy: browser → /api/ml/* → Python ML service on Railway.
// WHY: the frontend must NEVER see INTERNAL_API_TOKEN. This route is the
// one place we stamp the bearer header, and we only expose the surface
// we trust (GET + POST, same path segments). See ARCHITECTURE.md
// § Security Model and CLAUDE.md § Critical Non-Negotiables.

import { NextRequest, NextResponse } from "next/server";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN ?? "";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

// SECURITY: explicit allowlist. The Python service disables /docs and
// /openapi.json, but we still defense-in-depth here so any future
// endpoint we add on FastAPI is NOT auto-exposed to the browser.
const ALLOWED: ReadonlyArray<{ method: "GET" | "POST"; path: string }> = [
  { method: "GET", path: "health" },
  { method: "POST", path: "ingest" },
  { method: "POST", path: "train" },
  { method: "POST", path: "analyze" },
  { method: "POST", path: "simulate" },
  { method: "POST", path: "projects/upsert" },
  { method: "POST", path: "projects/delete" },
];

function isAllowed(method: string, pathSegments: string[]): boolean {
  const joined = pathSegments.join("/");
  return ALLOWED.some((e) => e.method === method && e.path === joined);
}

async function forward(req: NextRequest, ctx: RouteContext) {
  if (!INTERNAL_API_TOKEN) {
    // SECURITY: fail closed. An empty token on the server means either a
    // missing Vercel env var or a local dev .env.local — either way we
    // refuse rather than send an unauthenticated request that the Python
    // service will reject loudly.
    return NextResponse.json(
      { error: "ML proxy not configured: INTERNAL_API_TOKEN missing" },
      { status: 503 },
    );
  }

  const { path } = await ctx.params;
  if (!isAllowed(req.method, path)) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404 },
    );
  }

  const target = `${ML_SERVICE_URL.replace(/\/$/, "")}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${INTERNAL_API_TOKEN}`);
  // WHY: our ML service speaks JSON on every allowlisted endpoint. Pinning
  // the content-type here refuses unexpected media (multipart, xml) that
  // could trigger different parser paths on the FastAPI side.
  if (req.method !== "GET") headers.set("content-type", "application/json");

  const init: RequestInit = {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error — duplex is required by the fetch spec when
    // streaming a request body but not yet in lib.dom.d.ts for Node runtime.
    duplex: "half",
    cache: "no-store",
  };

  try {
    const upstream = await fetch(target, init);
    const respHeaders = new Headers(upstream.headers);
    // WHY: strip hop-by-hop and transport headers Next.js will set itself.
    respHeaders.delete("content-encoding");
    respHeaders.delete("content-length");
    respHeaders.delete("transfer-encoding");
    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "ML service unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  return forward(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  return forward(req, ctx);
}

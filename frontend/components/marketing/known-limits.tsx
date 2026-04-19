// Known-limits block — honest notes about what this build is and isn't.
// WHY: on a demo project, voluntarily flagging the edges earns more trust
// than hiding them. Pulled from IMPLEMENTATION.md § Scope Boundaries and
// README limitations.

import type { ReactElement } from "react";
import { Info } from "lucide-react";

const LIMITS: Array<{ title: string; body: string }> = [
  {
    title: "Single-user demo mode",
    body:
      "RLS isn't wired — anyone hitting the cloud URL can see every portfolio. Fine for a review, not fine for production. Multi-tenant auth is deliberately out of scope.",
  },
  {
    title: "Tiny training set",
    body:
      "The default dataset is 15 rows. Training accuracy is reported as training accuracy — no cross-validation, because 9 completed rows would overfit worse than a naive train.",
  },
  {
    title: "ivfflat index over-partitions",
    body:
      "pgvector's ivfflat assumes bigger corpora. On a handful of documents the retrieval is effectively a scan. Perfectly acceptable for this scale; noted so the number isn't mistaken for production tuning.",
  },
  {
    title: "OpenRouter rate + spend caps",
    body:
      "Chat depends on DeepSeek via OpenRouter. If the demo cap runs out, the query function surfaces a 502 instead of silently failing.",
  },
];

export function KnownLimits(): ReactElement {
  return (
    <section aria-labelledby="limits-heading" className="pb-20">
      <header className="max-w-2xl">
        <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          Honest notes
        </p>
        <h2 id="limits-heading" className="text-h1 mt-2 text-foreground">
          What this build isn't.
        </h2>
        <p className="mt-3 text-body text-muted-foreground">
          Shipping fast means being upfront about edges. Four things a reviewer
          should know before drawing conclusions about scale.
        </p>
      </header>

      <ul className="mt-8 grid gap-3 md:grid-cols-2">
        {LIMITS.map((l) => (
          <li
            key={l.title}
            className="rounded-md border border-border bg-card p-4"
          >
            <div className="flex gap-3">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Info className="size-3" aria-hidden />
              </span>
              <div>
                <p className="text-h3 text-foreground">{l.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {l.body}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

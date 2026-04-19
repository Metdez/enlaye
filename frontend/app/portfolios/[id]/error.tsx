"use client";

// Route-level error boundary for /portfolios/[id]/**.
// WHY: Next.js App Router requires error boundaries to be client components
// with `{ error, reset }`. `reset()` re-renders the same route segment —
// equivalent to a retry without a full navigation.

import { useEffect, type ReactElement } from "react";

import { ErrorState } from "@/components/state/error-state";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function PortfolioError({
  error,
  reset,
}: ErrorProps): ReactElement {
  useEffect(() => {
    // WHY: dev-time visibility. In production Next.js will have already
    // logged via the server error digest pipeline, so this is additive.
    // eslint-disable-next-line no-console
    console.error("Portfolio route error:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
      <ErrorState
        title="Couldn't load this portfolio"
        description={error.message || "An unexpected error occurred."}
        onRetry={reset}
        retryLabel="Retry"
      />
    </div>
  );
}

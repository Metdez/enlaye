"use client";

// Train-models button — primary CTA above ModelComparison.
// WHY: behavioral contract preserved from [legacy train-models-button](../train-models-button.tsx):
// same AbortController lifecycle, same FastAPI `detail` extraction, same
// /api/ml/train proxy call. Visual layer now uses the design-system Button,
// a Tooltip for the disabled state, and toasts instead of an inline banner.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toastError, toastSuccess } from "@/lib/toast";

// FastAPI error bodies passed through our proxy. Union covers the three
// known shapes plus a permissive fallback so the narrowing helper never
// throws on unexpected inputs.
type TrainErrorBody =
  | {
      detail: {
        error: "insufficient training data";
        n_completed_projects: number;
        minimum_required: number;
      };
    }
  | { detail: { error: "portfolio not found"; portfolio_id: string } }
  | { detail: string }
  | { [k: string]: unknown };

function extractTrainError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if ("detail" in b) {
      const detail = b.detail;
      if (typeof detail === "string") {
        if (detail.toLowerCase().includes("not implemented")) {
          return "Training not yet implemented.";
        }
        return detail;
      }
      if (detail && typeof detail === "object") {
        const d = detail as Record<string, unknown>;
        const err = typeof d.error === "string" ? d.error : null;
        if (err === "insufficient training data") {
          const n =
            typeof d.n_completed_projects === "number"
              ? d.n_completed_projects
              : 0;
          const min =
            typeof d.minimum_required === "number" ? d.minimum_required : 5;
          return `Not enough completed projects to train (${n} of ${min} required).`;
        }
        if (err === "portfolio not found") {
          return "Portfolio not found.";
        }
      }
    }
    if (typeof b.error === "string") {
      const detail = typeof b.detail === "string" ? `: ${b.detail}` : "";
      return `Training failed (${status}): ${b.error}${detail}`;
    }
  }
  return `Training failed: ${status}.`;
}

export function TrainModelsButton({
  portfolioId,
  disabled,
  disabledReason,
}: {
  portfolioId: string;
  disabled?: boolean;
  disabledReason?: string;
}): ReactElement {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // WHY: holds the live AbortController so a parent unmount aborts the
  // in-flight request instead of leaking it.
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const onClick = useCallback(async () => {
    if (loading || disabled) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);

    try {
      const res = await fetch("/api/ml/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          // non-JSON error body
        }
        const msg = extractTrainError(body as TrainErrorBody | null, res.status);
        toastError("Training failed", { description: msg });
        return;
      }

      toastSuccess("Models trained");
      // Re-runs server component data loaders so ModelComparison picks up
      // the new rows without a full navigation.
      router.refresh();
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg =
        err instanceof Error
          ? `Training failed: ${err.message}`
          : "Training failed: unknown error.";
      toastError("Training failed", { description: msg });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, [loading, disabled, portfolioId, router]);

  const isDisabled = loading || Boolean(disabled);

  const button = (
    <Button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading}
      aria-label={loading ? "Training models, please wait" : "Train models"}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          Training…
        </>
      ) : (
        <>
          <Sparkles aria-hidden />
          Train models
        </>
      )}
    </Button>
  );

  // WHY: wrap in a tooltip only when disabled with a reason. A disabled
  // <button> swallows pointer events, so we wrap a plain <span> as the
  // tooltip trigger — Base-UI's Tooltip keeps it accessible via keyboard.
  if (disabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-block" tabIndex={0}>
              {button}
            </span>
          }
        />
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }
  return button;
}

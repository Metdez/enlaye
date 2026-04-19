"use client";

// "Add project" dialog — opens a Dialog that contains ProjectForm in add mode.
// WHY: the dialog owns the fetch + router.refresh lifecycle so ProjectForm
// stays presentational. On 409 (duplicate external id) we keep the dialog
// open and surface the error inline; every other outcome closes cleanly.

import { useCallback, useId, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { ProjectForm } from "@/components/features/project-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toastError, toastSuccess } from "@/lib/toast";
import type {
  ProjectUpsertInput,
  ProjectUpsertRequest,
  ProjectUpsertResponse,
} from "@/lib/types";

type ProjectAddDialogProps = {
  portfolioId: string;
  typeOptions: string[];
  regionOptions: string[];
};

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      detail?: string | { error?: string; details?: string };
      error?: string;
    };
    if (typeof body.detail === "string") return body.detail;
    if (body.detail && typeof body.detail === "object") {
      return body.detail.error ?? body.detail.details ?? res.statusText;
    }
    if (body.error) return body.error;
  } catch {
    // non-JSON
  }
  return `${res.status} ${res.statusText}`;
}

export function ProjectAddDialog({
  portfolioId,
  typeOptions,
  regionOptions,
}: ProjectAddDialogProps): ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const titleId = useId();

  // Close handler — abort any in-flight request so the component can unmount
  // cleanly. The form itself resets on next open because we key its `initial`
  // by the dialog state.
  const handleOpenChange = useCallback((next: boolean) => {
    if (!next && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setOpen(next);
  }, []);

  const handleSubmit = useCallback(
    async (values: ProjectUpsertInput): Promise<void> => {
      setSubmitting(true);
      // Replace any prior abort controller (defensive — the dialog is modal so
      // there should only be one in flight at a time).
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const body: ProjectUpsertRequest = {
          portfolio_id: portfolioId,
          project: values,
        };
        const res = await fetch("/api/ml/projects/upsert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const msg = await extractErrorMessage(res);
          // 409 duplicate — throw so the form renders the banner inline,
          // keeps the dialog open for retry.
          if (res.status === 409) {
            throw new Error(
              msg ||
                "A project with that External ID already exists in this portfolio.",
            );
          }
          // Other errors — toast + keep dialog open.
          toastError("Could not add project", { description: msg });
          throw new Error(msg);
        }
        const parsed = (await res.json()) as ProjectUpsertResponse;
        toastSuccess("Project added", {
          description: `Risk scores recomputed (${parsed.analyze.n_rules} rules over ${parsed.analyze.n_projects} projects).`,
        });
        setOpen(false);
        router.refresh();
      } finally {
        setSubmitting(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [portfolioId, router],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <Plus aria-hidden />
            Add project
          </Button>
        }
      />
      <DialogContent
        className="max-w-2xl p-0"
        // The form has a border-t footer; suppress the default ring so it
        // doesn't double up with our own.
      >
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle id={titleId} className="text-h2">
              Add a project
            </DialogTitle>
            <DialogDescription>
              Adds a manually-entered project to this portfolio and re-runs
              the analysis.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-5 pb-5 pt-4">
            <ProjectForm
              typeOptions={typeOptions}
              regionOptions={regionOptions}
              onSubmit={handleSubmit}
              submitting={submitting}
              submitLabel="Add project"
              titleId={titleId}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

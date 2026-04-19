"use client";

// Slide-in edit sheet for an existing project. Includes a destructive
// "Delete project" affordance that opens a nested confirm Dialog.
// WHY: the sheet is "owned" by the table's parent so it can be re-used
// across rows without remounting the whole tree on each selection.

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

import { ProjectForm } from "@/components/features/project-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toastError, toastSuccess } from "@/lib/toast";
import type {
  ProjectDeleteRequest,
  ProjectDeleteResponse,
  ProjectRow,
  ProjectUpsertInput,
  ProjectUpsertRequest,
  ProjectUpsertResponse,
} from "@/lib/types";

type ProjectEditSheetProps = {
  project: ProjectRow;
  portfolioId: string;
  typeOptions: string[];
  regionOptions: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function ProjectEditSheet({
  project,
  portfolioId,
  typeOptions,
  regionOptions,
  open,
  onOpenChange,
}: ProjectEditSheetProps): ReactElement {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const titleId = useId();

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleSubmit = useCallback(
    async (values: ProjectUpsertInput): Promise<void> => {
      setSubmitting(true);
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const body: ProjectUpsertRequest = {
          portfolio_id: portfolioId,
          project: { ...values, id: project.id },
        };
        const res = await fetch("/api/ml/projects/upsert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const msg = await extractErrorMessage(res);
          if (res.status !== 409) {
            toastError("Could not save changes", { description: msg });
          }
          throw new Error(msg);
        }
        const parsed = (await res.json()) as ProjectUpsertResponse;
        toastSuccess("Project updated", {
          description: `Risk scores recomputed (${parsed.analyze.n_rules} rules over ${parsed.analyze.n_projects} projects).`,
        });
        onOpenChange(false);
        router.refresh();
      } finally {
        setSubmitting(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [onOpenChange, portfolioId, project.id, router],
  );

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const body: ProjectDeleteRequest = {
        portfolio_id: portfolioId,
        project_id: project.id,
      };
      const res = await fetch("/api/ml/projects/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await extractErrorMessage(res);
        toastError("Could not delete project", { description: msg });
        return;
      }
      const parsed = (await res.json()) as ProjectDeleteResponse;
      toastSuccess("Project deleted", {
        description: `Risk scores recomputed (${parsed.analyze.n_rules} rules over ${parsed.analyze.n_projects} projects).`,
      });
      setConfirmOpen(false);
      onOpenChange(false);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }, [onOpenChange, portfolioId, project.id, router]);

  const projectLabel = project.project_name || project.project_id_external || "this project";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px] md:max-w-[520px]"
      >
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle id={titleId} className="text-h2">
            Edit project
          </SheetTitle>
          <SheetDescription>
            <span className="font-mono text-meta">
              {project.project_id_external ?? "—"}
            </span>
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5">
          <ProjectForm
            initial={project}
            typeOptions={typeOptions}
            regionOptions={regionOptions}
            onSubmit={handleSubmit}
            submitting={submitting}
            submitLabel="Save changes"
            titleId={titleId}
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 p-4">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={submitting || deleting}
          >
            <Trash2 aria-hidden />
            Delete
          </Button>
          <p className="text-meta text-muted-foreground">
            Changes recompute risk scores.
          </p>
        </div>
      </SheetContent>

      {/* Nested confirm dialog — rendered inside the Sheet so focus returns
          cleanly to the sheet footer on close. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {projectLabel}?</DialogTitle>
            <DialogDescription>
              This removes the project and recomputes the portfolio&rsquo;s
              risk analysis. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={deleting}>
                  Cancel
                </Button>
              }
            />
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              aria-busy={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete project"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

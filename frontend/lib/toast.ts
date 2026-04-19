// Thin typed facade over sonner's toast API.
// WHY: callers should not import sonner directly — this lets us
// swap the implementation and guarantees a consistent call shape.

import { toast, type ExternalToast } from "sonner";

type ToastOpts = ExternalToast;

/** Fire a success toast. */
export function toastSuccess(title: string, opts?: ToastOpts) {
  return toast.success(title, opts);
}

/** Fire an error toast. */
export function toastError(title: string, opts?: ToastOpts) {
  return toast.error(title, opts);
}

/** Fire an info toast. */
export function toastInfo(title: string, opts?: ToastOpts) {
  return toast.info(title, opts);
}

/** Fire a loading toast; returns the id so callers can resolve or dismiss. */
export function toastLoading(title: string, opts?: ToastOpts) {
  return toast.loading(title, opts);
}

"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/types";
import { useToast } from "@/components/ui/toast";

type FormActionFn<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/**
 * Wraps a Server Action for a client form:
 *  - submits through `onSubmit` (so typed values survive validation errors —
 *    React would otherwise reset uncontrolled fields after the action),
 *  - toasts the result,
 *  - tracks a "dirty" flag for the "Not saved" badge,
 *  - exposes field errors from the last result.
 */
export function useFormAction<T = undefined>(
  action: FormActionFn<T>,
  opts: { onSuccess?: (result: Extract<ActionResult<T>, { ok: true }>) => void; toastSuccess?: boolean; toastError?: boolean } = {},
) {
  const toast = useToast();
  const [dirty, setDirty] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult<T> | null, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      setDirty(false);
      if (opts.toastSuccess ?? true) toast.success(result.message ?? "Saved");
      opts.onSuccess?.(result);
    } else if (opts.toastError ?? true) {
      toast.error(result.error);
    }
    return result;
  }, null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  /** Submit an arbitrary FormData (e.g. from a button outside the form). */
  const submit = (formData: FormData) => startTransition(() => formAction(formData));

  const errors: Record<string, string> = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const formError = state && !state.ok ? state.error : null;

  return {
    state,
    pending,
    onSubmit,
    submit,
    errors,
    formError,
    dirty,
    markDirty: () => setDirty(true),
    resetDirty: () => setDirty(false),
  };
}

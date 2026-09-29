"use client";

import { startTransition, useActionState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import type { ActionResult } from "@/lib/types";
import { useToast } from "@/components/ui/toast";

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

let currentNow = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function tick() {
  currentNow = Date.now();
  clockListeners.forEach((l) => l());
}

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    currentNow = Date.now();
    clockTimer = setInterval(tick, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function getClockSnapshot() {
  if (!currentNow) currentNow = Date.now();
  return currentNow;
}

/**
 * The current time, ticking every second. During SSR and hydration it returns
 * `serverNow` so markup matches; afterwards it follows the browser clock.
 */
export function useNow(serverNow: number): number {
  return useSyncExternalStore(subscribeClock, getClockSnapshot, () => serverNow);
}

/* ------------------------------------------------------------------ */
/* Viewer timezone                                                     */
/* ------------------------------------------------------------------ */

function subscribeNever() {
  return () => {};
}

function getViewerZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The browser's IANA timezone (null during SSR/hydration). */
export function useViewerTimeZone(): string | null {
  return useSyncExternalStore(subscribeNever, getViewerZone, () => null);
}

/* ------------------------------------------------------------------ */
/* Server action helpers                                               */
/* ------------------------------------------------------------------ */

type FormAction<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

interface ActionFormOptions<T> {
  onSuccess?: (result: { ok: true; data: T; message?: string }) => void;
  /** Show the action's success message as a toast (default true). */
  toast?: boolean;
}

/**
 * Wraps a form Server Action with `useActionState`. Submitting through
 * `onSubmit` keeps the typed values in place when validation fails (React
 * would otherwise reset uncontrolled fields after the action).
 */
export function useActionForm<T = undefined>(action: FormAction<T>, options: ActionFormOptions<T> = {}) {
  const toast = useToast();
  const [state, dispatch, pending] = useActionState<ActionResult<T> | null, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      if (options.toast !== false && result.message) toast.success(result.message);
      options.onSuccess?.(result);
    }
    return result;
  }, null);

  const submit = (formData: FormData) => startTransition(() => dispatch(formData));
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(new FormData(event.currentTarget));
  };
  return {
    state,
    pending,
    onSubmit,
    submit,
    error: state && !state.ok ? state.error : null,
    fieldErrors: (state && !state.ok ? (state.fieldErrors ?? {}) : {}) as Record<string, string>,
  };
}

/** Run button-style Server Actions (remove, move, publish…) with toasts. */
export function useServerAction() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, opts: { onSuccess?: (data: T, message?: string) => void; toast?: boolean } = {}) => {
    start(async () => {
      try {
        const result = await fn();
        if (result.ok) {
          if (opts.toast !== false && result.message) toast.success(result.message);
          opts.onSuccess?.(result.data, result.message);
        } else {
          toast.error(result.error);
        }
      } catch (err) {
        // Redirects are control flow handled by Next.js – rethrow them.
        if (err && typeof err === "object" && "digest" in err && String((err as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) throw err;
        toast.error("Something went wrong. Please try again.");
      }
    });
  };
  return { pending, run };
}

"use client";

import { useSyncExternalStore } from "react";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils";

const noopSubscribe = () => () => {};

/** True after hydration (false during SSR and the hydration render) — without an effect. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function utcFallback(iso: string, withTime: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "UTC",
  });
}

/**
 * Renders a date in the viewer's own timezone. The server (and the hydration
 * pass) render a UTC value, then the client swaps in the local one, so there
 * is never a hydration mismatch.
 */
export function LocalTime({
  iso,
  format = "datetime",
  className,
}: {
  iso: string | undefined;
  format?: "date" | "datetime" | "relative" | "time";
  className?: string;
}) {
  const hydrated = useHydrated();
  if (!iso) return null;
  let text: string;
  if (!hydrated) {
    text = format === "date" ? utcFallback(iso, false) : format === "time" ? utcFallback(iso, true).split(", ").pop() ?? "" : utcFallback(iso, true);
  } else if (format === "date") text = formatDate(iso);
  else if (format === "relative") text = relativeTime(iso);
  else if (format === "time") {
    const d = new Date(iso);
    text = Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } else text = formatDateTime(iso);
  return (
    <time dateTime={iso} className={className} title={hydrated ? formatDateTime(iso) : undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}

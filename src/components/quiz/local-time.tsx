"use client";

import { useSyncExternalStore } from "react";
import { intlLocale } from "@/i18n/config";
import { useFormatter } from "@/i18n/client";

const noopSubscribe = () => () => {};

/** True after hydration (false during SSR and the hydration render) — without an effect. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function utcFallback(iso: string, withTime: boolean, tag: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(tag, {
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
  const f = useFormatter();
  if (!iso) return null;
  const tag = intlLocale(f.locale);
  let text: string;
  if (!hydrated) {
    if (format === "time") {
      const d = new Date(iso);
      text = Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    } else text = utcFallback(iso, format !== "date", tag);
  } else if (format === "date") text = f.date(iso);
  else if (format === "relative") text = f.relative(iso);
  else if (format === "time") {
    const d = new Date(iso);
    text = Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } else text = f.dateTime(iso);
  return (
    <time dateTime={iso} className={className} title={hydrated ? f.dateTime(iso) : undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}

"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards (no effects, no mismatches). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const clockSubscribers = new Map<number, (callback: () => void) => () => void>();

function clockSubscribe(intervalMs: number) {
  let sub = clockSubscribers.get(intervalMs);
  if (!sub) {
    sub = (callback: () => void) => {
      const id = window.setInterval(callback, intervalMs);
      return () => window.clearInterval(id);
    };
    clockSubscribers.set(intervalMs, sub);
  }
  return sub;
}

/**
 * Current time that re-renders every `intervalMs`. The server snapshot is the
 * `initialNow` passed from the server so hydration is deterministic.
 */
export function useNow(intervalMs: number, initialNow: number): number {
  return useSyncExternalStore(
    clockSubscribe(intervalMs),
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => initialNow,
  );
}

type Mode = "datetime" | "date" | "time" | "weekday-datetime";

function formatLocal(iso: string, mode: Mode): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  switch (mode) {
    case "date":
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    case "time":
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    case "weekday-datetime":
      return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    default:
      return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
}

function formatUtc(iso: string, mode: Mode): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions =
    mode === "date"
      ? { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }
      : mode === "time"
        ? { hour: "numeric", minute: "2-digit", timeZone: "UTC" }
        : { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" };
  return `${d.toLocaleString("en-US", opts)}${mode === "date" ? "" : " UTC"}`;
}

/** Renders an ISO instant in the viewer's own time zone (UTC during SSR). */
export function LocalDateTime({ iso, mode = "datetime", className }: { iso: string; mode?: Mode; className?: string }) {
  const client = useIsClient();
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {client ? formatLocal(iso, mode) : formatUtc(iso, mode)}
    </time>
  );
}

/** "3 days ago" computed on the client (the UTC date during SSR and hydration). */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useNow(60000, 0);
  const client = now > 0;
  let text = formatUtc(iso, "date");
  if (client) {
    const diff = Math.round((new Date(iso).getTime() - now) / 1000);
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ["year", 31536000],
      ["month", 2592000],
      ["week", 604800],
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
    ];
    text = abs < 45 ? "just now" : rtf.format(Math.round(diff / 60), "minute");
    for (const [unit, secs] of units) {
      if (abs >= secs) {
        text = rtf.format(Math.round(diff / secs), unit);
        break;
      }
    }
  }
  return (
    <time dateTime={iso} className={className} title={client ? formatLocal(iso, "datetime") : undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}

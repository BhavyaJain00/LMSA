"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { formatLocalDate, formatLocalTime, formatUtcDate, localTimeZoneName, unlockLabelParts } from "./drip-shared";

/* ------------------------------------------------------------------ */
/* Shared ticking clock                                                 */
/* ------------------------------------------------------------------ */

interface Clock {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => number;
}

/**
 * One interval per resolution, shared by every subscriber. The snapshot is
 * cached between ticks (as useSyncExternalStore requires) and refreshed when
 * the first subscriber arrives.
 */
function createClock(intervalMs: number): Clock {
  let now = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  const tick = () => {
    now = Date.now();
    for (const listener of listeners) listener();
  };
  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (timer === null) {
        now = Date.now();
        timer = setInterval(tick, intervalMs);
      }
      return () => {
        listeners.delete(onChange);
        if (!listeners.size && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    getSnapshot() {
      if (!now) now = Date.now();
      return now;
    },
  };
}

const secondClock = createClock(1000);
const minuteClock = createClock(30_000);
const serverSnapshot = () => 0;

/**
 * The current time on the client, ticking every second or every 30 seconds.
 * Returns null during server rendering and hydration, so markup that depends
 * on the viewer's clock or time zone renders a stable fallback first.
 */
export function useNow(resolution: "second" | "minute" = "minute"): number | null {
  const clock = resolution === "second" ? secondClock : minuteClock;
  const value = useSyncExternalStore(clock.subscribe, clock.getSnapshot, serverSnapshot);
  return value === 0 ? null : value;
}

/**
 * Refresh the route (once) shortly after the next future unlock time, so a
 * page that shows scheduled lessons as locked opens them on time without a
 * manual reload. Times that already passed at mount are ignored (avoids
 * refresh loops when the server clock is behind the browser clock).
 */
export function useRefreshWhenUnlocked(times: number | readonly number[] | null): void {
  const router = useRouter();
  const list = times === null ? [] : typeof times === "number" ? [times] : times;
  const key = list
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
    .join(",");
  useEffect(() => {
    if (!key) return;
    const target = key
      .split(",")
      .map(Number)
      .find((t) => t > Date.now());
    if (target === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const wait = target + 2000 - Date.now();
      if (wait <= 0) {
        router.refresh();
        return;
      }
      // setTimeout overflows above ~24.8 days: re-arm in steps.
      timer = setTimeout(arm, Math.min(wait, 2_000_000_000));
    };
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key, router]);
}

/* ------------------------------------------------------------------ */
/* Labels                                                               */
/* ------------------------------------------------------------------ */

/** "Saturday, October 4, 2026 at 9:30 AM (GMT+5:30)" in the viewer's time zone (English). */
export function fullLocalDateTime(ms: number, now: number): string {
  const tz = localTimeZoneName(ms);
  return `${formatLocalDate(ms, now, { weekday: true })} at ${formatLocalTime(ms)}${tz ? ` (${tz})` : ""}`;
}

export interface UnlockText {
  /** "Saturday, October 4, 2026 at 9:30 AM (GMT+5:30)" in the viewer's time zone and language. */
  full: (ms: number, now: number) => string;
  /** "Unlocks in 3 days" / "Unlocks on Oct 4" in the viewer's time zone and language. */
  label: (ms: number, now: number) => string;
  /** Server-safe "Unlocks on Oct 4, 2026" (UTC date), shown until the browser renders local time. */
  fallback: (ms: number) => string;
  /** Server-safe "Oct 2, 2026 at 12:00 (UTC)": the exact release instant in UTC. Empty for an invalid instant. */
  utcDateTime: (ms: number) => string;
}

/**
 * Unlock dates and labels in the interface language. English keeps the
 * deterministic UTC fallbacks of `drip-shared`; other languages use `Intl`
 * pinned to UTC, so server and client markup still match before hydration.
 */
export function useUnlockText(): UnlockText {
  const t = useT("learning");
  const locale = useLocale();
  return useMemo(() => {
    const tag = intlLocale(locale);
    const localDate = (ms: number, now: number, weekday = false): string => {
      if (locale === "en") return formatLocalDate(ms, now, { weekday });
      const d = new Date(ms);
      const sameYear = d.getFullYear() === new Date(now).getFullYear();
      return d.toLocaleDateString(tag, {
        ...(weekday ? { weekday: "long" } : {}),
        month: weekday ? "long" : "short",
        day: "numeric",
        ...(sameYear && !weekday ? {} : { year: "numeric" }),
      });
    };
    const localTime = (ms: number): string => (locale === "en" ? formatLocalTime(ms) : new Date(ms).toLocaleTimeString(tag, { hour: "numeric", minute: "2-digit" }));
    const utcDate = (ms: number): string =>
      locale === "en" ? formatUtcDate(ms) : new Date(ms).toLocaleDateString(tag, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
    return {
      full: (ms, now) => {
        const zone = localTimeZoneName(ms);
        const date = localDate(ms, now, true);
        const time = localTime(ms);
        return zone ? t("global.unlock.dateAtTimeZone", { date, time, zone }) : t("global.unlock.dateAtTime", { date, time });
      },
      label: (ms, now) => {
        const { kind, count } = unlockLabelParts(ms, now);
        switch (kind) {
          case "now":
            return t("global.unlock.now");
          case "lessThanMinute":
            return t("global.unlock.lessThanMinute");
          case "minutes":
            return t("global.unlock.inMinutes", { count });
          case "hours":
            return t("global.unlock.inHours", { count });
          case "tomorrow":
            return t("global.unlock.tomorrow");
          case "days":
            return t("global.unlock.inDays", { count });
          case "on":
            return t("global.unlock.on", { date: localDate(ms, now) });
        }
      },
      fallback: (ms) => t("global.unlock.on", { date: utcDate(ms) }),
      utcDateTime: (ms) =>
        Number.isFinite(ms) ? t("global.unlock.dateAtTimeZone", { date: utcDate(ms), time: new Date(ms).toISOString().slice(11, 16), zone: "UTC" }) : "",
    };
  }, [t, locale]);
}

/**
 * "Unlocks in 3 days" / "Unlocks on Oct 4" in the viewer's local time, with
 * the full local date and time as a tooltip. Before hydration it shows the
 * UTC date so server and client markup match.
 */
export function UnlockLabel({ at, className, icon = false }: { at: string; className?: string; icon?: boolean }) {
  const now = useNow("minute");
  const text = useUnlockText();
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const label = now === null ? text.fallback(ms) : text.label(ms, now);
  const title = now === null ? undefined : text.full(ms, now);
  return (
    <time dateTime={at} title={title} className={cn("inline-flex items-center gap-1", className)}>
      {icon && <Icon.Clock className="size-3 shrink-0" aria-hidden="true" />}
      {label}
    </time>
  );
}

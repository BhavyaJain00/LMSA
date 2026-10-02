"use client";

import { useEffect, useState } from "react";
import { countdownParts } from "@/lib/seo/sales-page";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Live offer countdown of a sales page. The first render uses the server's
 * clock (so server and browser HTML match), then it ticks every second and
 * disappears once the offer has ended.
 */
export function SalesCountdown({ endsAt, serverNow, label, className }: { endsAt: string; serverNow: number; label?: string; className?: string }) {
  const t = useT("public");
  const f = useFormatter();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = countdownParts(endsAt, now);
  if (parts.done) return null;
  const units: { value: number; short: string; long: string }[] = [
    ...(parts.days > 0 ? [{ value: parts.days, short: t("sales.countdown.daysShort"), long: t("sales.countdown.days", { count: parts.days }) }] : []),
    { value: parts.hours, short: t("sales.countdown.hoursShort"), long: t("sales.countdown.hours") },
    { value: parts.minutes, short: t("sales.countdown.minutesShort"), long: t("sales.countdown.minutes") },
    { value: parts.seconds, short: t("sales.countdown.secondsShort"), long: t("sales.countdown.seconds") },
  ];
  const ends = new Date(endsAt);

  return (
    <div className={cn("inline-flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink", className)}>
      <Icon.Timer className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="font-medium">{label ?? t("sales.countdown.label")}</span>
      {/* Screen readers get the end date once instead of a value that changes every second (formatted in UTC so server and browser agree). */}
      <span className="sr-only">
        {f.date(ends.toISOString(), { weekday: "long", month: "long", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })}
      </span>
      <span aria-hidden="true" className="flex items-center gap-1 font-mono tabular-nums" dir="ltr">
        {units.map((u, i) => (
          <span key={i} className="rounded-md bg-surface-1 px-1.5 py-0.5 font-semibold text-ink shadow-sm" title={u.long}>
            {i === 0 && parts.days > 0 ? u.value : pad(u.value)}
            <span className="ms-0.5 text-xs font-normal text-ink-muted">{u.short}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { countdownParts } from "@/lib/seo/sales-page";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Live offer countdown of a sales page. The first render uses the server's
 * clock (so server and browser HTML match), then it ticks every second and
 * disappears once the offer has ended.
 */
export function SalesCountdown({ endsAt, serverNow, label = "Offer ends in", className }: { endsAt: string; serverNow: number; label?: string; className?: string }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = countdownParts(endsAt, now);
  if (parts.done) return null;
  const units: { value: number; short: string; long: string }[] = [
    ...(parts.days > 0 ? [{ value: parts.days, short: "d", long: parts.days === 1 ? "day" : "days" }] : []),
    { value: parts.hours, short: "h", long: "hours" },
    { value: parts.minutes, short: "m", long: "minutes" },
    { value: parts.seconds, short: "s", long: "seconds" },
  ];
  const ends = new Date(endsAt);

  return (
    <div className={cn("inline-flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink", className)}>
      <Icon.Timer className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="font-medium">{label}</span>
      {/* Screen readers get the end date once instead of a value that changes every second. */}
      <span className="sr-only">{ends.toUTCString()}</span>
      <span aria-hidden="true" className="flex items-center gap-1 font-mono tabular-nums">
        {units.map((u) => (
          <span key={u.short} className="rounded-md bg-surface-1 px-1.5 py-0.5 font-semibold text-ink shadow-sm" title={u.long}>
            {u.short === "d" ? u.value : pad(u.value)}
            <span className="ms-0.5 text-xs font-normal text-ink-muted">{u.short}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

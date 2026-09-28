"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useViewerTimeZone } from "./hooks";
import { dayKeyInZone, formatGmtOffset, tzOffsetMinutes, zonedTimeToUtc } from "./tz";

function formatInZone(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(epochMs));
}

function formatDayInZone(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(epochMs));
}

/**
 * Converts a wall-clock session (date + start/end time in the batch timezone)
 * into the viewer's local time using Intl.DateTimeFormat with `timeZone`.
 * Renders nothing on the server and when the viewer is in the same offset.
 */
export function LocalTimeRange({
  date,
  startTime,
  endTime,
  timezone,
  className,
  label = "Your time",
  showDay = false,
  compact = false,
}: {
  date: string;
  startTime: string;
  endTime?: string;
  timezone: string;
  className?: string;
  label?: string;
  /** Always show the local day (useful for one-off classes). */
  showDay?: boolean;
  compact?: boolean;
}) {
  const viewerTz = useViewerTimeZone();
  if (!viewerTz) return null;
  const start = zonedTimeToUtc(date, startTime, timezone);
  if (Number.isNaN(start)) return null;
  let end = endTime ? zonedTimeToUtc(date, endTime, timezone) : NaN;
  if (!Number.isNaN(end) && end < start) end += 86400000;
  const sameOffset = tzOffsetMinutes(viewerTz, start) === tzOffsetMinutes(timezone, start);
  if (sameOffset && !showDay) return null;

  const localDay = dayKeyInZone(start, viewerTz);
  const dayDiffers = localDay !== date;
  const range = Number.isNaN(end) ? formatInZone(start, viewerTz) : `${formatInZone(start, viewerTz)} – ${formatInZone(end, viewerTz)}`;
  const day = showDay || dayDiffers ? `${formatDayInZone(start, viewerTz)}, ` : "";

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-ink-muted", className)} title={`Converted to ${viewerTz}`}>
      {!compact && <Icon.MapPin className="size-3.5 shrink-0 text-ink-faint" />}
      <span>
        {label}: {day}
        <span className="font-medium text-ink">{range}</span>{" "}
        <span className="text-ink-faint">
          ({viewerTz.replace(/_/g, " ")}, {formatGmtOffset(viewerTz, start)})
        </span>
      </span>
    </span>
  );
}

/** A single instant (epoch ms) in the viewer's local time, e.g. for class start. */
export function LocalInstant({ at, className }: { at: number; className?: string }) {
  const viewerTz = useViewerTimeZone();
  if (!viewerTz || Number.isNaN(at)) return null;
  return (
    <span className={cn("text-xs text-ink-muted", className)}>
      {formatDayInZone(at, viewerTz)}, {formatInZone(at, viewerTz)} your time
    </span>
  );
}

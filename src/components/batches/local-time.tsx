"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useViewerTimeZone } from "./hooks";
import { dayKeyInZone, formatGmtOffset, tzOffsetMinutes, zonedTimeToUtc } from "./tz";
import { useLocale, useT } from "@/i18n/client";
import { intlLocale } from "@/i18n/config";

function formatInZone(epochMs: number, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(epochMs));
}

function formatDayInZone(epochMs: number, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(epochMs));
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
  label,
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
  // `global.` keys: also shown in the admin live class list.
  const t = useT("public");
  const locale = useLocale();
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
  const range = Number.isNaN(end) ? formatInZone(start, viewerTz, locale) : `${formatInZone(start, viewerTz, locale)} – ${formatInZone(end, viewerTz, locale)}`;
  const zone = viewerTz.replace(/_/g, " ");

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-ink-muted", className)} title={t("global.localTime.convertedTo", { zone })}>
      {!compact && <Icon.MapPin className="size-3.5 shrink-0 text-ink-faint" />}
      <span>
        {t.rich(showDay || dayDiffers ? "global.localTime.rangeWithDay" : "global.localTime.range", {
          label: label ?? t("global.localTime.yourTime"),
          day: formatDayInZone(start, viewerTz, locale),
          range,
          zone,
          offset: formatGmtOffset(viewerTz, start),
          b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
          muted: (chunks) => <span className="text-ink-faint">{chunks}</span>,
        })}
      </span>
    </span>
  );
}

/** A single instant (epoch ms) in the viewer's local time, e.g. for class start. */
export function LocalInstant({ at, className }: { at: number; className?: string }) {
  const t = useT("public");
  const locale = useLocale();
  const viewerTz = useViewerTimeZone();
  if (!viewerTz || Number.isNaN(at)) return null;
  return (
    <span className={cn("text-xs text-ink-muted", className)}>
      {t("global.localTime.instant", { day: formatDayInZone(at, viewerTz, locale), time: formatInZone(at, viewerTz, locale) })}
    </span>
  );
}

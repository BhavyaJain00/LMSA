"use client";

import Link from "next/link";
import type { DashboardLiveClass } from "@/lib/data/dashboard";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { AddToCalendar } from "@/components/pwa/add-to-calendar";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { formatInZone, sessionState, timeUntil } from "./time";
import { useNow } from "./use-now";

/** Product names stay as they are; only the generic label is translated. */
const providerLabel: Record<Exclude<DashboardLiveClass["provider"], "custom">, string> = {
  zoom: "Zoom",
  google_meet: "Google Meet",
};

/**
 * Live class card: shows the class in the viewer's local time and the join
 * state. Join/Start are offered only on the day of the class until it ends;
 * afterwards it shows "Ended" (and a recording link when available).
 * Rendered on the dashboard and the admin overview, so its strings are `global.` keys.
 */
export function LiveClassCard({ liveClass, className }: { liveClass: DashboardLiveClass; className?: string }) {
  const t = useT("account");
  const locale = useLocale();
  const tag = intlLocale(locale);
  const provider = liveClass.provider === "custom" ? t("global.liveClass.onlineMeeting") : providerLabel[liveClass.provider];
  const now = useNow();
  const start = new Date(liveClass.startsAt);
  const end = new Date(liveClass.endsAt);
  const state = now === null ? null : sessionState({ start, end }, now);

  // Before hydration render in the class's own timezone (deterministic); afterwards in local time.
  const zone = now === null ? liveClass.timezone : undefined;
  const dateLabel =
    zone !== undefined
      ? formatInZone(start, zone, { weekday: "long", month: "long", day: "numeric", year: "numeric" }, locale)
      : start.toLocaleDateString(tag, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const timeLabel =
    zone !== undefined
      ? `${formatInZone(start, zone, timeOpts, locale)} – ${formatInZone(end, zone, { ...timeOpts, timeZoneName: "short" }, locale)}`
      : `${start.toLocaleTimeString(tag, timeOpts)} – ${end.toLocaleTimeString(tag, { ...timeOpts, timeZoneName: "short" })}`;

  const canJoin = state === "live" || state === "today";
  // startUrl is only present for viewers allowed to start the meeting.
  const startHref = liveClass.canStart ? liveClass.startUrl || liveClass.joinUrl : liveClass.joinUrl;

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-card border border-border bg-surface-1 p-4 shadow-card transition-colors hover:border-border-strong",
        state === "live" && "border-success/40 ring-1 ring-success/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-semibold text-ink">{liveClass.title}</h3>
          <Link href={`/batches/${liveClass.batch.slug}`} className="mt-0.5 block truncate text-xs text-ink-muted hover:text-accent">
            {liveClass.batch.title}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {state === "live" && (
            <Badge tone="success" dot className="shrink-0 animate-pulse">
              {t("global.liveClass.liveNow")}
            </Badge>
          )}
          {state === "today" && (
            <Badge tone="info" className="shrink-0">
              {t("global.liveClass.today")}
            </Badge>
          )}
          {state !== "ended" && (
            <AddToCalendar
              size="xs"
              event={{
                uid: `live-class-${liveClass.id}`,
                title: liveClass.title,
                description: [
                  liveClass.description,
                  liveClass.joinUrl ? t("global.evaluation.calendarJoin", { link: liveClass.joinUrl }) : "",
                  t("global.evaluation.calendarBatch", { title: liveClass.batch.title }),
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                location: liveClass.joinUrl || provider,
                url: `/batches/${liveClass.batch.slug}?tab=classes#class-${liveClass.id}`,
                start: start.getTime(),
                end: end.getTime(),
                icsHref: `/api/calendar/event?type=live_class&id=${encodeURIComponent(liveClass.id)}`,
              }}
            />
          )}
        </div>
      </div>
      {liveClass.description && <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{liveClass.description}</p>}

      <dl className="mt-3 space-y-1.5 text-sm text-ink">
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("global.evaluation.date")}</dt>
          <Icon.Calendar className="size-4 shrink-0 text-ink-faint" />
          <dd className="min-w-0 truncate">{dateLabel}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("global.evaluation.time")}</dt>
          <Icon.Clock className="size-4 shrink-0 text-ink-faint" />
          <dd className="min-w-0 truncate">{timeLabel}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("global.liveClass.where")}</dt>
          <Icon.Video className="size-4 shrink-0 text-ink-faint" />
          <dd className="min-w-0 truncate text-ink-muted">{provider}</dd>
        </div>
        {liveClass.host && (
          <div className="flex items-center gap-2">
            <dt className="sr-only">{t("global.liveClass.host")}</dt>
            <Avatar name={liveClass.host.name} src={liveClass.host.avatarUrl} size="xs" />
            <dd className="min-w-0 truncate text-ink-muted">{t("global.liveClass.hostedBy", { name: liveClass.host.name })}</dd>
          </div>
        )}
      </dl>

      <div className="mt-auto pt-4">
        {state === null && <div className="h-8" aria-hidden="true" />}
        {state === "upcoming" && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <Icon.Timer className="size-3.5" />
            {t("global.liveClass.starts", { when: timeUntil(start.getTime(), now!, locale) })}
          </p>
        )}
        {canJoin && (
          <div className="flex gap-2">
            {liveClass.canStart && (
              <ButtonLink
                href={startHref}
                variant="outline"
                size="sm"
                className={liveClass.joinUrl ? "flex-1" : "w-full"}
                leftIcon={<Icon.Monitor className="size-4" />}
              >
                {t("global.liveClass.start")}
              </ButtonLink>
            )}
            {liveClass.joinUrl && (
              <ButtonLink href={liveClass.joinUrl} size="sm" className="flex-1" leftIcon={<Icon.Video className="size-4" />}>
                {t("global.liveClass.join")}
              </ButtonLink>
            )}
          </div>
        )}
        {state === "today" && (
          <p className="mt-2 text-xs text-ink-muted">{t("global.liveClass.starts", { when: timeUntil(start.getTime(), now!, locale) })}</p>
        )}
        {state === "ended" && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tooltip label={t("global.liveClass.endedHint")}>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warning" tabIndex={0}>
                <Icon.Info className="size-4" />
                {t("global.liveClass.ended")}
              </span>
            </Tooltip>
            {liveClass.recordingUrl && (
              <Link
                href={`/batches/${liveClass.batch.slug}?tab=classes`}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <Icon.Play className="size-3" />
                {t("global.liveClass.watchRecording")}
              </Link>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

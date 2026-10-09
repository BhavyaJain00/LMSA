"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { formatInZone, sessionState } from "../time";
import { useNow } from "../use-now";

/** A live class or a booked evaluation, flattened for one "Coming up" row (serializable: built on the server). */
export interface ComingUpEvent {
  kind: "live" | "evaluation";
  id: string;
  title: string;
  /** The one meta line under the title ("Live class · React Weekend Cohort"). */
  meta: string;
  /** Page with the full details (batch classes tab, course certification page), or null. */
  href: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  /** Join link for learners (meeting link for evaluations). */
  joinUrl?: string;
  /** Start link, only for viewers allowed to start the meeting. */
  startUrl?: string;
}

/**
 * One time-based row: date and time on the right in the viewer's local time, "Live now" / "Today" and a Join
 * button on the day. Before hydration it renders in the event's own timezone so server and client markup match.
 */
export function ComingUpEventRow({ event }: { event: ComingUpEvent }) {
  const t = useT("account");
  const locale = useLocale();
  const now = useNow();
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const state = now === null ? null : sessionState({ start, end }, now);
  const zone = now === null ? event.timezone || "UTC" : undefined;
  const tag = intlLocale(locale);
  const dayOpts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const dayLabel = zone !== undefined ? formatInZone(start, zone, dayOpts, locale) : start.toLocaleDateString(tag, dayOpts);
  const timeLabel = zone !== undefined ? formatInZone(start, zone, timeOpts, locale) : start.toLocaleTimeString(tag, timeOpts);

  const joinable = state === "live" || state === "today";
  const joinHref = event.startUrl || event.joinUrl;
  const joinLabel = event.startUrl ? t("global.liveClass.start") : event.kind === "evaluation" ? t("global.evaluation.joinCall") : t("global.liveClass.join");

  return (
    <li className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:gap-4 sm:px-5">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-5",
          state === "live" ? "bg-success/15 text-success" : "bg-accent/10 text-accent",
        )}
        aria-hidden="true"
      >
        {event.kind === "live" ? <Icon.Video /> : <Icon.GraduationCap />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">
          {event.href ? (
            <Link href={event.href} className="before:absolute before:inset-0 before:content-[''] hover:text-accent">
              {event.title}
            </Link>
          ) : (
            event.title
          )}
        </span>
        <span className="block truncate text-meta text-ink-faint">{event.meta}</span>
      </span>
      <span className="relative flex shrink-0 flex-col items-end gap-1 text-end sm:flex-row sm:items-center sm:gap-3">
        {state === "live" ? (
          <span className="inline-flex items-center gap-1.5 text-meta font-semibold text-success">
            <span className="size-2 animate-pulse rounded-full bg-current" aria-hidden="true" />
            {event.kind === "evaluation" ? t("global.evaluation.inProgress") : t("global.liveClass.liveNow")}
          </span>
        ) : state === "ended" ? (
          <span className="text-meta font-medium text-ink-faint">{t("global.liveClass.ended")}</span>
        ) : (
          <span className="flex flex-col items-end leading-tight">
            <span className="text-meta font-semibold text-ink">{state === "today" ? t("global.liveClass.today") : dayLabel}</span>
            <span className="text-xs text-ink-faint">{timeLabel}</span>
          </span>
        )}
        {joinable && joinHref && (
          <ButtonLink href={joinHref} variant="secondary" size="sm" leftIcon={<Icon.Video className="size-4" />}>
            {joinLabel}
          </ButtonLink>
        )}
      </span>
    </li>
  );
}

"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { formatInZone, sessionState } from "../time";
import { useNow } from "../use-now";

/** A live class or an evaluation slot, flattened on the server into one "Coming up" row (serializable). */
export interface OverviewEvent {
  kind: "live" | "evaluation";
  id: string;
  title: string;
  /** One short line under the title ("Live class · React Weekend Cohort"). */
  meta: string;
  /** Page with the details (the batch's classes tab, the evaluator's schedule). */
  href: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  /** Meeting link offered on the day; "start" only for viewers allowed to start the class. */
  action?: { href: string; kind: "start" | "join" | "joinCall" };
}

/**
 * One compact row: what, when (in the viewer's local time) and, on the day, a Join / Start button.
 * Before hydration it renders in the event's own timezone so server and client markup match.
 */
export function OverviewEventRow({ event }: { event: OverviewEvent }) {
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

  const joinable = (state === "live" || state === "today") && !!event.action;
  const actionLabel =
    event.action?.kind === "start" ? t("global.liveClass.start") : event.action?.kind === "joinCall" ? t("global.evaluation.joinCall") : t("global.liveClass.join");

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
        <Link href={event.href} className="block truncate font-semibold text-ink before:absolute before:inset-0 before:content-[''] hover:text-accent">
          {event.title}
        </Link>
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
        {joinable && event.action && (
          <ButtonLink
            href={event.action.href}
            variant="secondary"
            size="sm"
            leftIcon={event.action.kind === "start" ? <Icon.Monitor className="size-4" /> : <Icon.Video className="size-4" />}
          >
            {actionLabel}
          </ButtonLink>
        )}
      </span>
    </li>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { DashboardEvaluation } from "@/lib/data/dashboard";
import { cancelEvaluationAction } from "@/lib/actions/profile";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { AddToCalendar } from "@/components/pwa/add-to-calendar";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { formatInZone, sessionState } from "./time";
import { useNow } from "./use-now";

/**
 * Upcoming certificate evaluation.
 * - "student" variant: shows the evaluator, a Join Call button on the day and
 *   an Options menu with Cancel for future evaluations.
 * - "evaluator" variant: shows the learner and links to the evaluator's schedule.
 *
 * Rendered on the dashboard and the admin overview, so its strings are `global.` keys.
 */
export function EvaluationCard({
  evaluation,
  variant = "student",
  scheduleHref,
  className,
}: {
  evaluation: DashboardEvaluation;
  variant?: "student" | "evaluator";
  scheduleHref?: string;
  className?: string;
}) {
  const t = useT("account");
  const locale = useLocale();
  const now = useNow();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const start = new Date(evaluation.startsAt);
  const end = new Date(evaluation.endsAt);
  const state = now === null ? null : sessionState({ start, end }, now);
  const zone = now === null ? evaluation.timezone || "UTC" : undefined;
  const tag = intlLocale(locale);
  const dateLabel =
    zone !== undefined
      ? formatInZone(start, zone, { day: "numeric", month: "long", year: "numeric" }, locale)
      : start.toLocaleDateString(tag, { day: "numeric", month: "long", year: "numeric" });
  const timeLabel =
    zone !== undefined
      ? formatInZone(start, zone, { hour: "numeric", minute: "2-digit" }, locale)
      : start.toLocaleTimeString(tag, { hour: "numeric", minute: "2-digit" });

  const person = variant === "student" ? evaluation.evaluator : evaluation.member;
  const showOptions = variant === "student" && evaluation.cancellable && state !== "ended" && state !== "live";
  // The evaluator variant is one big link to the schedule, so it can't hold a menu.
  const showCalendar = variant === "student" && state !== "ended";
  const canJoin = !!evaluation.meetingLink && (state === "live" || state === "today");

  const cancel = () => {
    startTransition(async () => {
      const res = await cancelEvaluationAction(evaluation.id);
      if (res.ok) {
        toast.success(res.message ?? t("global.evaluation.cancelled"));
        setConfirming(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className={cn("min-w-0 font-semibold text-ink", variant === "evaluator" && "text-base")}>
          <span className="line-clamp-2">{evaluation.courseTitle}</span>
        </h3>
        {(showCalendar || showOptions) && (
          <div className="flex shrink-0 items-center gap-0.5">
            {showCalendar && (
              <AddToCalendar
                size="xs"
                event={{
                  uid: `evaluation-${evaluation.id}`,
                  title: t("global.evaluation.calendarTitle", { course: evaluation.courseTitle }),
                  description: [
                    evaluation.meetingLink ? t("global.evaluation.calendarJoin", { link: evaluation.meetingLink }) : "",
                    evaluation.evaluator ? t("global.evaluation.calendarEvaluator", { name: evaluation.evaluator.name }) : "",
                    evaluation.batchTitle ? t("global.evaluation.calendarBatch", { title: evaluation.batchTitle }) : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                  location: evaluation.meetingLink,
                  url: evaluation.courseSlug ? `/courses/${evaluation.courseSlug}` : "/dashboard",
                  start: start.getTime(),
                  end: end.getTime(),
                  icsHref: `/api/calendar/event?type=evaluation&id=${encodeURIComponent(evaluation.id)}`,
                }}
              />
            )}
            {showOptions && (
              <Dropdown
                trigger={
                  <span className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink">
                    <Icon.MoreVertical className="size-4" />
                    <span className="sr-only">{t("global.evaluation.options")}</span>
                  </span>
                }
                items={[
                  {
                    label: t("global.evaluation.cancel"),
                    icon: <Icon.XCircle />,
                    destructive: true,
                    onClick: () => setConfirming(true),
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>
      {evaluation.batchTitle && <p className="mt-0.5 truncate text-xs text-ink-muted">{evaluation.batchTitle}</p>}
      <dl className="mt-3 space-y-1.5 text-sm text-ink">
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("global.evaluation.date")}</dt>
          <Icon.Calendar className="size-4 shrink-0 text-ink-faint" />
          <dd>{dateLabel}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">{t("global.evaluation.time")}</dt>
          <Icon.Clock className="size-4 shrink-0 text-ink-faint" />
          <dd>{timeLabel}</dd>
        </div>
        {evaluation.timezone && (
          <div className="flex items-center gap-2">
            <dt className="sr-only">{t("global.evaluation.timezone")}</dt>
            <Icon.Globe className="size-4 shrink-0 text-ink-faint" />
            <dd className="truncate text-ink-muted">{evaluation.timezone}</dd>
          </div>
        )}
        {person && (
          <div className="flex items-center gap-2">
            <dt className="sr-only">{variant === "student" ? t("global.evaluation.evaluator") : t("global.evaluation.learner")}</dt>
            <Icon.GraduationCap className="size-4 shrink-0 text-ink-faint" />
            <dd className="truncate">{person.name}</dd>
          </div>
        )}
      </dl>
      {state === "live" && <p className="mt-3 text-xs font-medium text-success">{t("global.evaluation.inProgress")}</p>}
    </>
  );

  return (
    <>
      {variant === "evaluator" && scheduleHref ? (
        <Link
          href={scheduleHref}
          className={cn(
            "block h-full rounded-card border border-border bg-surface-1 p-4 shadow-card transition-colors hover:border-border-strong",
            className,
          )}
        >
          {body}
        </Link>
      ) : (
        <article className={cn("flex h-full flex-col rounded-card border border-border bg-surface-1 p-4 shadow-card", className)}>
          {body}
          {canJoin && (
            <div className="mt-auto pt-4">
              <ButtonLink href={evaluation.meetingLink!} size="sm" className="w-full" leftIcon={<Icon.Video className="size-4" />}>
                {t("global.evaluation.joinCall")}
              </ButtonLink>
            </div>
          )}
        </article>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={cancel}
        loading={pending}
        destructive
        title={t("global.evaluation.confirmTitle")}
        description={t("global.evaluation.confirmBody")}
        confirmLabel={t("global.evaluation.confirmCancel")}
        cancelLabel={t("global.evaluation.keep")}
      />
    </>
  );
}

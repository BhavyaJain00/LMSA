"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useFormatter, useT } from "@/i18n/client";
import { countdownParts } from "./drip-shared";
import { useNow, useRefreshWhenUnlocked, useUnlockText } from "./unlock-time";

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-16 flex-col items-center rounded-xl border border-border bg-surface-1 px-3 py-2.5 sm:min-w-20">
      <span className="text-2xl font-semibold tabular-nums text-ink sm:text-3xl">{String(value).padStart(2, "0")}</span>
      <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{label}</span>
    </div>
  );
}

function useSrCountdown(): (ms: number) => string {
  const t = useT("learning");
  const f = useFormatter();
  return (ms) => {
    const { days, hours, minutes } = countdownParts(ms);
    const parts: string[] = [];
    if (days) parts.push(t("learn.drip.srDays", { count: days }));
    if (hours) parts.push(t("learn.drip.srHours", { count: hours }));
    if (!days && minutes) parts.push(t("learn.drip.srMinutes", { count: minutes }));
    return parts.length ? f.list(parts) : t("learn.drip.srLessThanMinute");
  };
}

/**
 * Shown instead of the lesson content while a scheduled (drip) lesson is not
 * released yet: a live countdown, the release date and time in the viewer's
 * own time zone, and links back. When the countdown ends the page refreshes
 * and the lesson opens.
 */
export function DripLockedCard({
  lessonTitle,
  unlocksAt,
  afterPrevious,
  courseHref,
  resume,
}: {
  lessonTitle: string;
  /** ISO instant the lesson is released. */
  unlocksAt: string;
  /** With enforced order the lesson also waits for the lessons before it. */
  afterPrevious: boolean;
  courseHref: string;
  /** Where the learner can continue meanwhile. */
  resume: { href: string; title: string } | null;
}) {
  const t = useT("learning");
  const text = useUnlockText();
  const srCountdown = useSrCountdown();
  const ms = Date.parse(unlocksAt);
  const now = useNow("second");
  // Screen readers get a minute-resolution update instead of a per-second one.
  const minuteNow = useNow("minute");
  useRefreshWhenUnlocked(Number.isFinite(ms) ? ms : null);

  const remaining = now === null ? null : Math.max(0, ms - now);
  const parts = countdownParts(remaining ?? 0);
  const unlocked = remaining !== null && remaining <= 0;
  // Before hydration (and without JavaScript) the exact UTC release time; then the viewer's local time.
  const when = now === null ? text.utcDateTime(ms) || unlocksAt : text.full(ms, now);

  return (
    <div className="mx-auto w-full max-w-(--lesson-w) py-6">
      <section aria-labelledby="drip-locked-title" className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
        <div className="flex flex-col items-center gap-4 px-5 pb-6 pt-8 text-center sm:px-8">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent/12 text-accent">
            {unlocked ? <Icon.Unlock className="size-7" aria-hidden="true" /> : <Icon.Clock className="size-7" aria-hidden="true" />}
          </span>
          <div className="max-w-md">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">{t("learn.drip.eyebrow")}</p>
            <h1 id="drip-locked-title" className="mt-1 text-xl font-semibold text-ink text-balance">
              {unlocked ? t("learn.drip.unlocking") : t("learn.drip.notYet")}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              {t.rich("learn.drip.opensOn", {
                lesson: lessonTitle,
                when,
                b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
                time: (chunks) => (
                  <time dateTime={unlocksAt} className="font-medium text-ink">
                    {chunks}
                  </time>
                ),
              })}
            </p>
          </div>

          {!unlocked && (
            <div className="flex flex-wrap items-center justify-center gap-2" aria-hidden="true">
              {remaining === null ? (
                <div className="h-18 w-72 animate-pulse rounded-xl bg-surface-2 motion-reduce:animate-none" />
              ) : (
                <>
                  <Unit value={parts.days} label={t("learn.drip.unitDays", { count: parts.days })} />
                  <Unit value={parts.hours} label={t("learn.drip.unitHours")} />
                  <Unit value={parts.minutes} label={t("learn.drip.unitMinutes")} />
                  <Unit value={parts.seconds} label={t("learn.drip.unitSeconds")} />
                </>
              )}
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {minuteNow === null ? "" : unlocked ? t("learn.drip.srUnlocking") : t("learn.drip.srUnlocksIn", { time: srCountdown(ms - minuteNow) })}
          </p>

          {afterPrevious && (
            <p className="flex max-w-md items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-start text-xs text-ink-muted">
              <Icon.Info className="mt-px size-4 shrink-0 text-ink-faint" aria-hidden="true" />
              {t("learn.drip.afterPrevious")}
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse items-stretch gap-2 border-t border-border bg-surface-2/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-center sm:px-8">
          <ButtonLink href={courseHref} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
            {t("learn.backToCourse")}
          </ButtonLink>
          {resume && (
            <ButtonLink href={resume.href} rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
              <span className="truncate">{t("learn.drip.continueWith", { title: resume.title })}</span>
            </ButtonLink>
          )}
        </div>
      </section>
      <p className="mt-4 text-center text-xs text-ink-faint">
        {t.rich("learn.drip.footer", {
          link: (chunks) => (
            <Link href={`${courseHref}#curriculum`} className="font-medium text-accent hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { countdownParts, formatUtcDate } from "./drip-shared";
import { fullLocalDateTime, useNow, useRefreshWhenUnlocked } from "./unlock-time";

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-16 flex-col items-center rounded-xl border border-border bg-surface-1 px-3 py-2.5 sm:min-w-20">
      <span className="text-2xl font-semibold tabular-nums text-ink sm:text-3xl">{String(value).padStart(2, "0")}</span>
      <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{label}</span>
    </div>
  );
}

function srCountdown(ms: number): string {
  const { days, hours, minutes } = countdownParts(ms);
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (!days && minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.length ? parts.join(", ") : "less than a minute";
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
  const ms = Date.parse(unlocksAt);
  const now = useNow("second");
  // Screen readers get a minute-resolution update instead of a per-second one.
  const minuteNow = useNow("minute");
  useRefreshWhenUnlocked(Number.isFinite(ms) ? ms : null);

  const remaining = now === null ? null : Math.max(0, ms - now);
  const parts = countdownParts(remaining ?? 0);
  const unlocked = remaining !== null && remaining <= 0;
  const when = now === null ? `${formatUtcDate(ms)} at 00:00 UTC` : fullLocalDateTime(ms, now);

  return (
    <div className="mx-auto w-full max-w-(--lesson-w) py-6">
      <section aria-labelledby="drip-locked-title" className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
        <div className="flex flex-col items-center gap-4 px-5 pb-6 pt-8 text-center sm:px-8">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent/12 text-accent">
            {unlocked ? <Icon.Unlock className="size-7" aria-hidden="true" /> : <Icon.Clock className="size-7" aria-hidden="true" />}
          </span>
          <div className="max-w-md">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">Scheduled lesson</p>
            <h1 id="drip-locked-title" className="mt-1 text-xl font-semibold text-ink text-balance">
              {unlocked ? "This lesson is unlocking…" : "This lesson isn't available yet"}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              <span className="font-medium text-ink">{lessonTitle}</span> opens on{" "}
              <time dateTime={unlocksAt} className="font-medium text-ink">
                {when}
              </time>
              .
            </p>
          </div>

          {!unlocked && (
            <div className="flex flex-wrap items-center justify-center gap-2" aria-hidden="true">
              {remaining === null ? (
                <div className="h-18 w-72 animate-pulse rounded-xl bg-surface-2 motion-reduce:animate-none" />
              ) : (
                <>
                  <Unit value={parts.days} label={parts.days === 1 ? "day" : "days"} />
                  <Unit value={parts.hours} label="hours" />
                  <Unit value={parts.minutes} label="min" />
                  <Unit value={parts.seconds} label="sec" />
                </>
              )}
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {minuteNow === null ? "" : unlocked ? "The lesson is unlocking. The page will refresh." : `Unlocks in ${srCountdown(ms - minuteNow)}.`}
          </p>

          {afterPrevious && (
            <p className="flex max-w-md items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left text-xs text-ink-muted">
              <Icon.Info className="mt-px size-4 shrink-0 text-ink-faint" aria-hidden="true" />
              This course unlocks lessons in order, so you&apos;ll also need to complete the lessons before it.
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse items-stretch gap-2 border-t border-border bg-surface-2/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-center sm:px-8">
          <ButtonLink href={courseHref} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4" />}>
            Back to course
          </ButtonLink>
          {resume && (
            <ButtonLink href={resume.href} rightIcon={<Icon.ArrowRight className="size-4" />}>
              <span className="truncate">Continue with {resume.title}</span>
            </ButtonLink>
          )}
        </div>
      </section>
      <p className="mt-4 text-center text-xs text-ink-faint">
        Scheduled lessons open automatically; this page refreshes when the countdown ends. See the full schedule on the{" "}
        <Link href={`${courseHref}#curriculum`} className="font-medium text-accent hover:underline">
          course page
        </Link>
        .
      </p>
    </div>
  );
}

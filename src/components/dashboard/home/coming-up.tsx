import Link from "next/link";
import type { ReactNode } from "react";
import type { PendingItem, PendingStatus, StudentDashboard } from "@/lib/data/dashboard";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getT } from "@/i18n/server";
import { cn, toDateKey } from "@/lib/utils";
import { ComingUpEventRow, type ComingUpEvent } from "./coming-up-event";

export type { ComingUpEvent } from "./coming-up-event";

/** Rows shown in "Coming up". */
export const COMING_UP_MAX = 5;

/**
 * Picks which rows fill the short list: time-based events first (soonest first), then pending work, keeping room
 * for up to two pending items when there are many events and giving spare rows to whichever list has more.
 */
export function pickComingUp<E, P>(events: E[], pending: P[], max = COMING_UP_MAX): { events: E[]; pending: P[] } {
  const pendingSlots = Math.min(pending.length, max - Math.min(events.length, max - 2));
  const eventSlots = Math.min(events.length, max - pendingSlots);
  return { events: events.slice(0, eventSlots), pending: pending.slice(0, pendingSlots) };
}

type AccountT = Awaited<ReturnType<typeof getT<"account">>>;

/**
 * The rows of "Coming up" from the dashboard data: live classes and evaluations that are not over yet (soonest
 * first), then pending work, capped at `COMING_UP_MAX`. `hiddenCount` is everything that did not fit.
 */
export function buildComingUp(
  data: Pick<StudentDashboard, "liveClasses" | "evaluations" | "upcomingCounts" | "pending">,
  t: AccountT,
  now = Date.now(),
): { events: ComingUpEvent[]; pending: PendingItem[]; hiddenCount: number } {
  const live = data.liveClasses.filter((c) => Date.parse(c.endsAt) > now);
  const evaluations = data.evaluations.filter((e) => Date.parse(e.endsAt) > now);
  const events: ComingUpEvent[] = [
    ...live.map(
      (c): ComingUpEvent => ({
        kind: "live",
        id: c.id,
        title: c.title,
        meta: `${t("dashboard.comingUp.liveClass")} · ${c.batch.title}`,
        href: `/batches/${c.batch.slug}?tab=classes#class-${c.id}`,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        timezone: c.timezone,
        joinUrl: c.joinUrl || undefined,
        // Same rule as the live class card: people who may start the meeting get the start link (or the join link).
        startUrl: c.canStart ? c.startUrl || c.joinUrl || undefined : undefined,
      }),
    ),
    ...evaluations.map(
      (e): ComingUpEvent => ({
        kind: "evaluation",
        id: e.id,
        title: e.courseTitle,
        meta: [t("dashboard.comingUp.evaluation"), e.batchTitle ?? e.evaluator?.name].filter(Boolean).join(" · "),
        // The certification page lists the booking with its calendar and cancel options.
        href: e.courseSlug ? `/courses/${e.courseSlug}/certification` : null,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        timezone: e.timezone,
        joinUrl: e.meetingLink || undefined,
      }),
    ),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const picked = pickComingUp(events, data.pending.items);
  // Upcoming sessions beyond the loader's caps, plus the rows that did not fit here.
  const beyondCaps = Math.max(0, data.upcomingCounts.liveClasses - live.length) + Math.max(0, data.upcomingCounts.evaluations - data.evaluations.length);
  const hiddenCount = beyondCaps + (events.length - picked.events.length) + Math.max(0, data.pending.total - picked.pending.length);
  return { events: picked.events, pending: picked.pending, hiddenCount };
}

const kindIcon: Record<PendingItem["kind"], ReactNode> = {
  quiz: <Icon.ListChecks />,
  assignment: <Icon.ClipboardList />,
  exercise: <Icon.Code />,
};
const kindLabel = {
  quiz: "dashboard.pending.kindQuiz",
  assignment: "dashboard.pending.kindAssignment",
  exercise: "dashboard.pending.kindExercise",
} as const satisfies Record<PendingItem["kind"], string>;
const statusCopy = {
  not_started: { label: "dashboard.pending.notStarted", className: "text-ink-muted" },
  retry: { label: "dashboard.pending.retry", className: "text-warning" },
  awaiting_grading: { label: "dashboard.pending.awaitingGrading", className: "text-info" },
} as const satisfies Record<PendingStatus, { label: string; className: string }>;

/** Live classes, evaluations and pending quizzes / assignments / exercises merged into one short list. */
export async function ComingUpList({ events, pending, hiddenCount }: { events: ComingUpEvent[]; pending: PendingItem[]; hiddenCount: number }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  const today = toDateKey();
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      <ul className="divide-y divide-border">
        {events.map((event) => (
          <ComingUpEventRow key={`${event.kind}:${event.id}`} event={event} />
        ))}
        {pending.map((item) => {
          const overdue = !!item.dueDate && item.dueDate < today && item.status !== "awaiting_grading";
          const status = statusCopy[item.status];
          return (
            <li key={item.key}>
              <Link href={item.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:gap-4 sm:px-5">
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-5",
                    item.status === "awaiting_grading" ? "bg-info/10 text-info" : "bg-surface-2 text-ink-muted",
                  )}
                  aria-hidden="true"
                >
                  {kindIcon[item.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink group-hover:text-accent">{item.title}</span>
                  <span className="block truncate text-meta text-ink-faint">
                    {t(kindLabel[item.kind])} · {item.context}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-end leading-tight">
                  <span className={cn("text-meta font-semibold", status.className)}>{t(status.label)}</span>
                  {item.dueDate && (
                    <span className={cn("text-xs", overdue ? "font-medium text-danger" : "text-ink-faint")}>
                      {overdue
                        ? t("dashboard.pending.overdue", { date: f.date(item.dueDate, { year: undefined }) })
                        : t("dashboard.pending.due", { date: f.date(item.dueDate, { year: undefined }) })}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && <p className="border-t border-border px-4 py-2.5 text-meta text-ink-faint sm:px-5">{t("dashboard.comingUp.more", { count: hiddenCount })}</p>}
    </div>
  );
}

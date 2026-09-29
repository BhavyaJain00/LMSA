import type { PointsReason } from "@/lib/types";
import type { IconName } from "@/components/ui/icons";

/**
 * Labels and copy for every points reason (client-safe). The order of
 * POINTS_REASONS is the order used in settings forms and breakdowns.
 */

export const POINTS_REASONS: PointsReason[] = [
  "lesson_complete",
  "quiz_pass",
  "quiz_perfect",
  "assignment_submit",
  "assignment_pass",
  "exercise_pass",
  "course_complete",
  "certificate",
  "streak_day",
  "discussion_reply",
  "review",
  "manual",
];

/** Reasons with a configurable default value (manual adjustments always carry their own amount). */
export const CONFIGURABLE_REASONS: Exclude<PointsReason, "manual">[] = [
  "lesson_complete",
  "quiz_pass",
  "quiz_perfect",
  "assignment_submit",
  "assignment_pass",
  "exercise_pass",
  "course_complete",
  "certificate",
  "streak_day",
  "discussion_reply",
  "review",
];

/** Most helpful replies that earn points per member per day. */
export const DISCUSSION_REPLY_DAILY_CAP = 10;

/** Upper bound for a configurable per-reason value. */
export const MAX_REASON_POINTS = 1000;

/** Largest single manual adjustment (either direction). */
export const MAX_MANUAL_POINTS = 10000;

export interface ReasonMeta {
  label: string;
  /** Short past-tense line for ledgers, e.g. "Completed a lesson". */
  ledger: string;
  /** How the points are earned, shown in settings and on the points page. */
  description: string;
  icon: IconName;
}

export const REASON_META: Record<PointsReason, ReasonMeta> = {
  lesson_complete: {
    label: "Lesson completed",
    ledger: "Completed a lesson",
    description: "Once per lesson, when it is marked complete.",
    icon: "CheckCircle",
  },
  quiz_pass: {
    label: "Quiz passed",
    ledger: "Passed a quiz",
    description: "The first time a quiz is passed.",
    icon: "ListChecks",
  },
  quiz_perfect: {
    label: "Perfect quiz score",
    ledger: "Scored 100% on a quiz",
    description: "Bonus for the first attempt that scores 100%.",
    icon: "Target",
  },
  assignment_submit: {
    label: "Assignment submitted",
    ledger: "Submitted an assignment",
    description: "Once per assignment, on the first submission.",
    icon: "ClipboardList",
  },
  assignment_pass: {
    label: "Assignment passed",
    ledger: "Assignment graded as pass",
    description: "When an evaluator grades the submission as pass.",
    icon: "Award",
  },
  exercise_pass: {
    label: "Exercise solved",
    ledger: "Solved a programming exercise",
    description: "The first time every test case of an exercise passes.",
    icon: "Code",
  },
  course_complete: {
    label: "Course completed",
    ledger: "Completed a course",
    description: "When every lesson of a course is complete.",
    icon: "GraduationCap",
  },
  certificate: {
    label: "Certificate earned",
    ledger: "Earned a certificate",
    description: "For each certificate issued.",
    icon: "Certificate",
  },
  streak_day: {
    label: "Learning day",
    ledger: "Learned something today",
    description: "Once per day with learning activity, so streaks add up.",
    icon: "Flame",
  },
  discussion_reply: {
    label: "Helpful reply",
    ledger: "Replied in a discussion",
    description: `Replying to someone else's question (up to ${DISCUSSION_REPLY_DAILY_CAP} replies a day).`,
    icon: "MessageSquare",
  },
  review: {
    label: "Course review",
    ledger: "Reviewed a course",
    description: "Once per course reviewed.",
    icon: "Star",
  },
  manual: {
    label: "Adjustment",
    ledger: "Adjusted by an administrator",
    description: "Points added or deducted by an administrator.",
    icon: "Sliders",
  },
};

export function isPointsReason(value: unknown): value is PointsReason {
  return typeof value === "string" && (POINTS_REASONS as string[]).includes(value);
}

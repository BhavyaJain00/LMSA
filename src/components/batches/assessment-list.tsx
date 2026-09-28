import Link from "next/link";
import type { ReactNode } from "react";
import { cn, formatDateTime } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import type { AssessmentRow, AssessmentStatus } from "./types";

export const assessmentTypeLabel: Record<AssessmentRow["type"], string> = {
  quiz: "Quiz",
  assignment: "Assignment",
  exercise: "Programming Exercise",
};

export const assessmentTypeIcon: Record<AssessmentRow["type"], ReactNode> = {
  quiz: <Icon.ListChecks />,
  assignment: <Icon.ClipboardList />,
  exercise: <Icon.Code />,
};

const statusTone: Record<AssessmentStatus, BadgeTone> = {
  pass: "success",
  fail: "danger",
  not_graded: "warning",
  pending: "warning",
  submitted: "info",
  not_attempted: "danger",
};

/** Green for Pass, amber for Not graded, red otherwise (e.g. Not attempted / Fail). */
export function AssessmentStatusBadge({ row, className }: { row: Pick<AssessmentRow, "status" | "statusLabel">; className?: string }) {
  return (
    <Badge tone={statusTone[row.status]} dot className={className}>
      {row.statusLabel}
    </Badge>
  );
}

function actionLabel(row: AssessmentRow): string {
  if (row.status === "not_attempted") return row.type === "quiz" ? "Start quiz" : row.type === "assignment" ? "Submit" : "Solve";
  if (row.status === "pass") return "View";
  if (row.type === "quiz") return "Retake";
  return row.type === "assignment" ? "View submission" : "Try again";
}

/** Assessments of a batch with the learner's status and links to take them. */
export function AssessmentList({
  rows,
  showActions = true,
  showStatus = true,
  className,
}: {
  rows: AssessmentRow[];
  showActions?: boolean;
  showStatus?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1", className)}>
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent [&>svg]:size-5" aria-hidden="true">
            {assessmentTypeIcon[row.type]}
          </span>
          <div className="min-w-0 flex-1">
            {row.missing ? (
              <p className="font-medium text-ink-muted line-through">{row.title}</p>
            ) : (
              <Link href={row.href} className="font-medium text-ink hover:text-accent">
                {row.title}
              </Link>
            )}
            <p className="mt-0.5 text-xs text-ink-muted">
              {assessmentTypeLabel[row.type]}
              {row.courseTitle && <> · {row.courseTitle}</>}
              {row.submittedAt && <> · Last submitted {formatDateTime(row.submittedAt)}</>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:justify-end">
            {showStatus && <AssessmentStatusBadge row={row} />}
            {showActions && !row.missing && (
              <Link
                href={row.href}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border-strong px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              >
                {showStatus ? actionLabel(row) : "Open"} <Icon.ChevronRight className="size-4" />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

import type { AssignmentStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ASSIGNMENT_STATUS_LABELS } from "./shared";

const assignmentTones: Record<AssignmentStatus, BadgeTone> = {
  pass: "success",
  fail: "danger",
  not_graded: "info",
  not_applicable: "neutral",
};

/** Pass = green, Not graded = blue, Fail = red, Not applicable = grey. */
export function AssignmentStatusBadge({ status, size = "sm", className }: { status: AssignmentStatus; size?: "xs" | "sm" | "md"; className?: string }) {
  return (
    <Badge tone={assignmentTones[status]} size={size} dot className={className}>
      {ASSIGNMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Passed = green, Failed = red. */
export function ExerciseStatusBadge({ status, size = "sm", className }: { status: "passed" | "failed"; size?: "xs" | "sm" | "md"; className?: string }) {
  return (
    <Badge tone={status === "passed" ? "success" : "danger"} size={size} dot className={className}>
      {status === "passed" ? "Passed" : "Failed"}
    </Badge>
  );
}

/** Amber "Not Saved" badge for dirty forms. */
export function NotSavedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warning" dot className={className}>
      Not Saved
    </Badge>
  );
}

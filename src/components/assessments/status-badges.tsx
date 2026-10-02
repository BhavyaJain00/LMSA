"use client";

import type { AssignmentStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useT } from "@/i18n/client";

const assignmentTones: Record<AssignmentStatus, BadgeTone> = {
  pass: "success",
  fail: "danger",
  not_graded: "info",
  not_applicable: "neutral",
};

/** Pass = green, Not graded = blue, Fail = red, Not applicable = grey. */
export function AssignmentStatusBadge({ status, size = "sm", className }: { status: AssignmentStatus; size?: "xs" | "sm" | "md"; className?: string }) {
  const t = useT("learning");
  return (
    <Badge tone={assignmentTones[status]} size={size} dot className={className}>
      {t(`global.assess.status.${status}`)}
    </Badge>
  );
}

/** Passed = green, Failed = red. */
export function ExerciseStatusBadge({ status, size = "sm", className }: { status: "passed" | "failed"; size?: "xs" | "sm" | "md"; className?: string }) {
  const t = useT("learning");
  return (
    <Badge tone={status === "passed" ? "success" : "danger"} size={size} dot className={className}>
      {status === "passed" ? t("global.assess.passed") : t("global.assess.failed")}
    </Badge>
  );
}

/** Amber "Not Saved" badge for dirty forms. */
export function NotSavedBadge({ className }: { className?: string }) {
  const t = useT("learning");
  return (
    <Badge tone="warning" dot className={className}>
      {t("global.assess.notSaved")}
    </Badge>
  );
}

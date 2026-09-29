"use client";

import { Checkbox } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { ProgramEnrollmentReport, ProgramPaidCourse } from "../types";

/** "A", "A and B", "A, B and C" */
function titleList(courses: ProgramPaidCourse[]): string {
  const titles = courses.map((c) => c.title);
  if (titles.length <= 1) return titles.join("");
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

/**
 * Notice and "Grant access without payment" box for a manager's program
 * change that would enroll members in paid courses (adding a member or a
 * course, lifting the course order). Off by default: members who haven't
 * bought a course are left out and need to purchase it first. Only the
 * courses' own managers may grant access; the server enforces the same rule.
 */
export function GrantPaidAccessField({
  id,
  name,
  courses,
  checked,
  onChange,
  single = false,
}: {
  id: string;
  /** Set when the box is part of a submitted form. */
  name?: string;
  courses: ProgramPaidCourse[];
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** One member is being enrolled (wording). */
  single?: boolean;
}) {
  if (!courses.length) return null;
  const grantable = courses.filter((c) => c.grantable);
  const locked = courses.filter((c) => !c.grantable);
  const it = courses.length === 1 ? "it" : "them";
  return (
    <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="flex items-start gap-2 text-sm text-ink">
        <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          {titleList(courses)} {courses.length === 1 ? "is a paid course" : "are paid courses"}.{" "}
          {single
            ? `If the member hasn't bought ${it}, they won't be enrolled and need to purchase ${it} first.`
            : `Members who haven't bought ${it} won't be enrolled and need to purchase ${it} first.`}
        </span>
      </p>
      {grantable.length > 0 && (
        <Checkbox
          id={id}
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          label="Grant access without payment"
          description={`Enroll ${single ? "the member" : "them"} in ${titleList(grantable)} without a purchase.`}
        />
      )}
      {locked.length > 0 && (
        <p className="text-xs text-ink-muted">
          Only instructors of {titleList(locked)} and moderators can grant access to {locked.length === 1 ? "it" : "them"} without payment.
        </p>
      )}
    </div>
  );
}

/** Toast for a manager's program change: a warning while members still need to purchase a course. */
export function useEnrollmentToast() {
  const toast = useToast();
  return (message: string | undefined, report: ProgramEnrollmentReport | undefined) => {
    if (!message) return;
    if (report?.needsPurchase.length) toast.toast({ title: message, tone: "warning", duration: 9000 });
    else toast.success(message);
  };
}

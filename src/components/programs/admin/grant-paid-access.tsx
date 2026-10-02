"use client";

import { Checkbox } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useFormatter, useT } from "@/i18n/client";
import type { ProgramEnrollmentReport, ProgramPaidCourse } from "../types";

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
  const t = useT("public");
  const f = useFormatter();
  if (!courses.length) return null;
  const grantable = courses.filter((c) => c.grantable);
  const locked = courses.filter((c) => !c.grantable);
  const titleList = (list: ProgramPaidCourse[]) => f.list(list.map((c) => c.title));
  return (
    <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="flex items-start gap-2 text-sm text-ink">
        <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          {t("programsAdmin.grant.paid", { count: courses.length, titles: titleList(courses) })}{" "}
          {single ? t("programsAdmin.grant.singleNotice", { count: courses.length }) : t("programsAdmin.grant.notice", { count: courses.length })}
        </span>
      </p>
      {grantable.length > 0 && (
        <Checkbox
          id={id}
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          label={t("programsAdmin.grant.label")}
          description={single ? t("programsAdmin.grant.singleDescription", { titles: titleList(grantable) }) : t("programsAdmin.grant.description", { titles: titleList(grantable) })}
        />
      )}
      {locked.length > 0 && <p className="text-xs text-ink-muted">{t("programsAdmin.grant.locked", { count: locked.length, titles: titleList(locked) })}</p>}
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

"use client";

import Link from "next/link";
import { useState } from "react";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import { removeBatchStudentAction } from "@/lib/actions/batches";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { Icon } from "@/components/ui/icons";
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { AssessmentStatusBadge, assessmentTypeLabel } from "../assessment-list";
import { useServerAction } from "../hooks";
import type { StudentProgressRow } from "../types";

/** One student's progress across the batch's courses and assessments. */
export function StudentProgressDialog({ student, onClose }: { student: StudentProgressRow | null; onClose: () => void }) {
  const hasWork = !!student && (student.courses.length > 0 || student.assessments.length > 0);
  return (
    <Dialog open={!!student} onClose={onClose} size="lg" title="Student progress">
      {student && (
        <div className="space-y-8">
          <div className="flex items-center gap-4">
            <Avatar name={student.user.name} src={student.user.avatarUrl} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold text-ink">{student.user.name}</h3>
                {hasWork && <Badge tone={student.overallProgress >= 100 ? "success" : "danger"}>{student.overallProgress}% Complete</Badge>}
              </div>
              <p className="truncate text-sm text-ink-muted">{student.user.email}</p>
              <p className="text-xs text-ink-faint" suppressHydrationWarning>
                Enrolled {formatDate(student.enrolledAt)}
                {student.lastActiveAt && <> · Last active {relativeTime(student.lastActiveAt)}</>}
              </p>
            </div>
          </div>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-ink">Assessments</h4>
            <Table>
              <THead>
                <tr>
                  <TH className="w-3/5">Assessment</TH>
                  <TH>Status / Percentage</TH>
                </tr>
              </THead>
              <TBody>
                {student.assessments.length === 0 && <TableEmpty colSpan={2}>No assessments added to this batch</TableEmpty>}
                {student.assessments.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <span className={cn("block font-medium", a.missing && "text-ink-muted line-through")}>{a.title}</span>
                      <span className="text-xs text-ink-muted">{assessmentTypeLabel[a.type]}</span>
                    </TD>
                    <TD>
                      <AssessmentStatusBadge row={a} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-ink">Courses</h4>
            <Table>
              <THead>
                <tr>
                  <TH className="w-3/5">Course</TH>
                  <TH>Progress</TH>
                </tr>
              </THead>
              <TBody>
                {student.courses.length === 0 && <TableEmpty colSpan={2}>No courses added to this batch</TableEmpty>}
                {student.courses.map((c) => (
                  <TR key={c.courseId}>
                    <TD>
                      <Link href={`/courses/${c.slug}`} className="font-medium text-ink hover:text-accent">
                        {c.title}
                      </Link>
                      {!c.enrolled && <span className="block text-xs text-warning">Not enrolled in this course</span>}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <ProgressBar value={c.progress} size="sm" className="max-w-32" tone={c.progress >= 100 ? "success" : "accent"} label={`${c.title} progress`} />
                        <span className="w-10 text-right text-xs tabular-nums text-ink-muted">{Math.ceil(c.progress)}%</span>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        </div>
      )}
    </Dialog>
  );
}

/**
 * Students of a batch with per-course progress, overall progress and last
 * activity. Rows open the progress dialog; students can be removed.
 */
export function StudentProgressTable({ batchId, students, courseTitles }: { batchId: string; students: StudentProgressRow[]; courseTitles: { id: string; title: string }[] }) {
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<StudentProgressRow | null>(null);
  const [removing, setRemoving] = useState<StudentProgressRow | null>(null);
  const { pending, run } = useServerAction();

  if (!students.length) {
    return (
      <EmptyState
        icon={<Icon.Users />}
        title="No students enrolled yet"
        description="Enroll students to track their progress here."
        action={
          <ButtonLink href={`/admin/batches/${batchId}?tab=students`} leftIcon={<Icon.UserPlus className="size-4" />}>
            Enroll students
          </ButtonLink>
        }
      />
    );
  }

  const q = query.trim().toLowerCase();
  const rows = students.filter((s) => !q || `${s.user.name} ${s.user.email}`.toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">Students</h2>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search students" leftAddon={<Icon.Search className="size-4" />} />
          </div>
          <ButtonLink href={`/admin/batches/${batchId}?tab=students`} variant="outline" leftIcon={<Icon.UserPlus className="size-4" />}>
            Enroll
          </ButtonLink>
        </div>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            {courseTitles.map((c) => (
              <TH key={c.id} className="min-w-32 normal-case tracking-normal" title={c.title}>
                <span className="line-clamp-1">{c.title}</span>
              </TH>
            ))}
            <TH>Overall</TH>
            <TH>Last active</TH>
            <TH>Enrolled on</TH>
            <TH className="text-right">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <TableEmpty colSpan={courseTitles.length + 5}>
              <span className="block font-medium text-ink">No students match your search</span>
              Try a different name
            </TableEmpty>
          )}
          {rows.map((s) => (
            <TR key={s.userId} clickable onClick={() => setViewing(s)}>
              <TD>
                <span className="flex min-w-44 items-center gap-2.5">
                  <Avatar name={s.user.name} src={s.user.avatarUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.user.name}</span>
                    <span className="block truncate text-xs text-ink-muted">{s.user.email}</span>
                  </span>
                </span>
              </TD>
              {s.courses.map((c) => (
                <TD key={c.courseId}>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={c.progress} size="xs" className="w-16" tone={c.progress >= 100 ? "success" : "accent"} label={`${c.title} progress`} />
                    <span className="text-xs tabular-nums text-ink-muted">{c.progress}%</span>
                  </div>
                </TD>
              ))}
              <TD>
                <span className={cn("font-semibold tabular-nums", s.overallProgress >= 100 ? "text-success" : "text-ink")}>{s.overallProgress}%</span>
              </TD>
              <TD className="whitespace-nowrap text-xs text-ink-muted" suppressHydrationWarning>
                {s.lastActiveAt ? relativeTime(s.lastActiveAt) : "Never"}
              </TD>
              <TD className="whitespace-nowrap text-xs text-ink-muted">{formatDate(s.enrolledAt)}</TD>
              <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex gap-1">
                  <IconButton label={`View progress of ${s.user.name}`} size="icon-sm" onClick={() => setViewing(s)}>
                    <Icon.TrendingUp className="size-4" />
                  </IconButton>
                  <IconButton label={`Remove ${s.user.name}`} size="icon-sm" onClick={() => setRemoving(s)} className="hover:text-danger">
                    <Icon.Trash className="size-4" />
                  </IconButton>
                </span>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <StudentProgressDialog student={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) run(() => removeBatchStudentAction(batchId, removing.userId), { onSuccess: () => setRemoving(null) });
        }}
        loading={pending}
        destructive
        title={`Remove ${removing?.user.name ?? "student"} from this batch?`}
        description="They will lose access to the batch's classes, announcements and discussions. Their course enrollments and progress are kept."
        confirmLabel="Remove"
      />
    </div>
  );
}

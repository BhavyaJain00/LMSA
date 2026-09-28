"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { getStudentProgressAction } from "@/lib/actions/courses";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import type { StudentAssessmentRow, StudentProgressDetail } from "./types";

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border", className)}>
      <h3 className="sticky top-0 border-b border-border bg-surface-2 px-4 py-2 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function StatusRows({ rows, empty }: { rows: StudentAssessmentRow[]; empty: string }) {
  if (!rows.length) return <p className="px-4 py-3 text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="min-w-0 truncate text-ink">{r.title}</span>
          <Badge tone={r.tone} dot>
            {r.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * Lesson-by-lesson and assessment progress for one enrolled learner.
 * Mount with a `key` per student so it fetches fresh data each time.
 */
export function StudentProgressDialog({ courseId, userId, onClose }: { courseId: string; userId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<StudentProgressDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    startLoading(async () => {
      const res = await getStudentProgressAction(courseId, userId);
      if (cancelled) return;
      if (res.ok) setDetail(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [courseId, userId]);

  const hasAssessments = !!detail && (detail.quizzes.length > 0 || detail.assignments.length > 0 || detail.exercises.length > 0);
  const lessons = detail?.chapters.flatMap((c) => c.lessons) ?? [];
  const completed = lessons.filter((l) => l.status === "complete").length;

  return (
    <Dialog open={userId !== null} onClose={onClose} title="Student Progress" size={hasAssessments ? "xl" : "lg"}>
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <Icon.AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : !detail || loading ? (
        <div className="space-y-5" aria-busy="true">
          <div className="flex items-center gap-3">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <ListSkeleton rows={4} />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={detail.user.name} src={detail.user.avatarUrl} size="lg" />
              <div className="min-w-0">
                <Link href={`/user/${detail.user.username}`} className="block truncate font-semibold text-ink hover:underline">
                  {detail.user.name}
                </Link>
                <p className="truncate text-sm text-ink-muted">{detail.user.email}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Enrolled {detail.enrolledLabel}
                  {detail.completedLabel && <> · Completed {detail.completedLabel}</>}
                  {detail.memberType !== "student" && <> · {detail.memberType}</>}
                </p>
              </div>
            </div>
            <div className="w-full sm:w-56">
              <p className="mb-1 text-right text-xs text-ink-muted">{detail.progress}% completed</p>
              <ProgressBar value={detail.progress} label="Course Progress" tone={detail.progress >= 100 ? "success" : "accent"} />
              {detail.certificateCode && (
                <Link href={`/certificates/${detail.certificateCode}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                  <Icon.Certificate className="size-3.5" /> View certificate
                </Link>
              )}
            </div>
          </div>

          <div className={cn("grid gap-4", hasAssessments && "lg:grid-cols-2")}>
            <Panel title={`Lesson Progress · ${completed}/${lessons.length}`} className="max-h-[60vh] overflow-y-auto">
              {detail.chapters.length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-muted">This course has no lessons yet.</p>
              ) : (
                detail.chapters.map((chapter) => (
                  <div key={chapter.chapterId}>
                    <p className="border-b border-border bg-surface-1 px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">{chapter.title}</p>
                    <ul className="divide-y divide-border">
                      {chapter.lessons.map((l) => (
                        <li key={l.lessonId} className="flex items-center gap-3 px-4 py-2 text-sm">
                          <span className="w-8 shrink-0 font-mono text-xs text-ink-faint">{l.index}</span>
                          <span className="min-w-0 flex-1 truncate text-ink">{l.title}</span>
                          {l.status === "complete" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-success" title="Complete">
                              <Icon.CheckCircleFilled className="size-4" />
                              <span className="sr-only sm:not-sr-only">Complete</span>
                            </span>
                          ) : l.status === "partial" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-warning" title="In progress">
                              <Icon.CircleDot className="size-4" />
                              <span className="sr-only sm:not-sr-only">In progress</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-ink-faint" title="Pending">
                              <Icon.Minus className="size-4" />
                              <span className="sr-only sm:not-sr-only">Pending</span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </Panel>
            {hasAssessments && (
              <div className="space-y-4">
                {detail.quizzes.length > 0 && (
                  <Panel title="Quiz Progress">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-ink-muted">
                        <tr className="border-b border-border">
                          <th className="px-4 py-2 font-medium">Quiz</th>
                          <th className="px-2 py-2 text-right font-medium">Score</th>
                          <th className="px-4 py-2 text-right font-medium">Percentage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {detail.quizzes.map((q) => (
                          <tr key={q.quizId}>
                            <td className="max-w-0 truncate px-4 py-2 text-ink">
                              {q.title}
                              {!q.attempted && <span className="ml-2 text-xs text-ink-faint">Not attempted</span>}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-ink-muted">
                              {q.score} / {q.scoreOutOf}
                            </td>
                            <td className={cn("px-4 py-2 text-right font-medium tabular-nums", q.attempted ? (q.passed ? "text-success" : "text-danger") : "text-ink-faint")}>{q.percentage}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Panel>
                )}
                {detail.assignments.length > 0 && (
                  <Panel title="Assignment Progress">
                    <StatusRows rows={detail.assignments} empty="No assignments." />
                  </Panel>
                )}
                {detail.exercises.length > 0 && (
                  <Panel title="Programming Exercise Progress">
                    <StatusRows rows={detail.exercises} empty="No programming exercises." />
                  </Panel>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

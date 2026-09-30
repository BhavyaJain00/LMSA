import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getAssessmentUsage, getAssignment, getCourseOptions, listAssignmentSubmissions } from "@/lib/data/assessments";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { AssignmentForm } from "@/components/assessments/assignment-form";
import { getDb } from "@/lib/db/store";
import { getRubricOptions } from "@/lib/teaching/rubrics";
import { allocationMode, normalizePeerConfig, type PeerConfig } from "@/lib/teaching/peer-shared";
import { AssignmentReviewSettings } from "@/components/teaching/assignment-review-settings";

export async function generateMetadata(props: PageProps<"/admin/assignments/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const assignment = await getAssignment(id);
  return { title: assignment ? `Edit ${assignment.title}` : "Edit Assignment" };
}

export default async function EditAssignmentPage(props: PageProps<"/admin/assignments/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/admin/assignments/${id}`);
  if (!canManageAssessments(user)) redirect("/courses");
  const assignment = await getAssignment(id);
  if (!assignment) notFound();

  const [courseOptions, usage, submissions, rubricOptions, db] = await Promise.all([
    getCourseOptions(user, assignment.courseId),
    getAssessmentUsage("assignment", assignment.id),
    listAssignmentSubmissions({ assignmentId: assignment.id }),
    getRubricOptions(),
    getDb(),
  ]);
  const peerReviews = db.peerReviews.filter((r) => r.assignmentId === assignment.id);
  const counts = {
    total: submissions.length,
    pending: submissions.filter((s) => s.status === "not_graded").length,
    passed: submissions.filter((s) => s.status === "pass").length,
    failed: submissions.filter((s) => s.status === "fail").length,
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Assignments", href: "/admin/assignments" }, { label: assignment.title }]} />}
        title="Edit Assignment"
        description={assignment.title}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <AssignmentForm
            assignment={{
              id: assignment.id,
              title: assignment.title,
              type: assignment.type,
              courseId: assignment.courseId,
              question: assignment.question,
              enableScheduling: assignment.enableScheduling,
              scheduleStart: assignment.scheduleStart,
              scheduleEnd: assignment.scheduleEnd,
              showAnswer: assignment.showAnswer,
              answer: assignment.answer,
              gradeAssignment: assignment.gradeAssignment,
            }}
            courseOptions={courseOptions}
          />
          <AssignmentReviewSettings
            assignmentId={assignment.id}
            rubricOptions={rubricOptions}
            rubricId={assignment.rubricId ?? null}
            peer={normalizePeerConfig(assignment.peerReview as PeerConfig | undefined)}
            deadline={allocationMode(assignment) === "deadline" ? (assignment.scheduleEnd ?? null) : null}
            gradeAssignment={assignment.gradeAssignment}
            stats={{ assigned: peerReviews.length, completed: peerReviews.filter((r) => r.status === "submitted").length }}
          />
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title="Submissions" />
            <CardBody className="grid grid-cols-2 gap-3 text-center">
              {[
                { label: "Total", value: counts.total },
                { label: "To grade", value: counts.pending },
                { label: "Passed", value: counts.passed },
                { label: "Failed", value: counts.failed },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-surface-2 px-2 py-3">
                  <p className="text-xl font-semibold text-ink">{s.value}</p>
                  <p className="text-xs text-ink-muted">{s.label}</p>
                </div>
              ))}
              <Link href={`/admin/assignments/submissions?assignment=${assignment.id}`} className="col-span-2 text-sm font-medium text-accent hover:underline">
                View submissions
              </Link>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Used in" description="Lessons and batches that include this assignment." />
            <CardBody>
              {usage.length === 0 ? (
                <p className="text-sm text-ink-muted">Not embedded anywhere yet. Add it to a lesson with the Assignment block in the lesson editor.</p>
              ) : (
                <ul className="space-y-2.5 text-sm">
                  {usage.map((u) => (
                    <li key={`${u.lessonId}-${u.courseTitle}`} className="flex items-start gap-2">
                      <Icon.BookOpen className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                      <div className="min-w-0">
                        {u.href ? (
                          <Link href={u.href} className="font-medium text-ink hover:underline">
                            {u.lessonTitle}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink">{u.lessonTitle}</span>
                        )}
                        <p className="truncate text-xs text-ink-muted">{u.courseTitle}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

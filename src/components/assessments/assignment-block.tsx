import { getCurrentUser } from "@/lib/auth/session";
import { getLessonHref } from "@/lib/data/courses";
import { canManageAssessments, getAssignment, getOwnAssignmentSubmission, toAssignmentView, toSubmissionView } from "@/lib/data/assessments";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { AssignmentFeedback } from "@/components/teaching/assignment-feedback";
import { getT } from "@/i18n/server";
import { AssignmentPanel } from "./assignment-panel";
import { lessonQuery } from "./shared";

/**
 * Assignment embedded in a lesson: the question plus the learner's
 * type-specific submission form, status, evaluator comments and model answer.
 */
export async function AssignmentBlock({ assignmentId, lessonId, courseId }: { assignmentId: string; lessonId?: string; courseId?: string }) {
  const [assignment, user, t] = await Promise.all([getAssignment(assignmentId), getCurrentUser(), getT("learning")]);
  if (!assignment) {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm text-ink-muted">
        <Icon.AlertCircle className="size-5 shrink-0 text-ink-faint" />
        {t("assignment.gone")}
      </Card>
    );
  }

  const own = user ? await getOwnAssignmentSubmission(user.id, assignment.id) : null;
  const privileged = canManageAssessments(user);
  const lessonHref = lessonId ? await getLessonHref(lessonId) : null;
  const effectiveCourseId = courseId ?? assignment.courseId;
  const pageHref = `/assignments/${assignment.id}${lessonQuery(lessonId, effectiveCourseId)}`;

  return (
    <div className="space-y-4">
      <AssignmentPanel
        variant="inline"
        assignment={toAssignmentView(assignment, { includeAnswer: !!own })}
        submission={own ? await toSubmissionView(own) : null}
        viewerName={user?.name ?? null}
        loginHref={`/login?next=${encodeURIComponent(lessonHref ?? pageHref)}`}
        lessonId={lessonId}
        courseId={effectiveCourseId}
        initialNow={new Date().getTime()}
        privileged={privileged}
        manageHref={privileged ? `/admin/assignments/submissions?assignment=${assignment.id}` : null}
        pageHref={pageHref}
      />
      <AssignmentFeedback assignmentId={assignment.id} userId={user?.id ?? null} privileged={privileged} />
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import {
  canManageAssessments,
  getAssignment,
  getOwnAssignmentSubmission,
  getReturnLink,
  toAssignmentView,
  toSubmissionView,
} from "@/lib/data/assessments";
import { getAssessmentAccess } from "@/lib/data/lessons";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { AssignmentPanel } from "@/components/assessments/assignment-panel";
import { Breadcrumbs, type Crumb } from "@/components/assessments/breadcrumbs";
import { lessonQuery, param } from "@/components/assessments/shared";
import { AssignmentFeedback } from "@/components/teaching/assignment-feedback";
import { getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/assignments/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const [assignment, t] = await Promise.all([getAssignment(id), getT("learning")]);
  return { title: assignment ? assignment.title : t("assignment.page.metaTitle") };
}

export default async function AssignmentPage(props: PageProps<"/assignments/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const lessonParam = param(sp.lesson);
  const courseIdParam = param(sp.course);
  const user = await requireUser(`/assignments/${id}${lessonQuery(lessonParam, courseIdParam)}`);

  const [assignment, t] = await Promise.all([getAssignment(id), getT("learning")]);
  if (!assignment) notFound();

  const db = await getDb();
  const courseId = courseIdParam ?? assignment.courseId;
  const course = courseId ? db.courses.find((c) => c.id === courseId) : undefined;
  const privileged = canManageAssessments(user);

  // Learners reach an assignment through a lesson they can open (drip schedule, enforced order and
  // prerequisites apply) or a batch that lists it; staff always can.
  const gate = privileged ? null : await getAssessmentAccess(user, "assignment", assignment.id);
  if (gate && !gate.ok) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          breadcrumbs={
            <Breadcrumbs
              items={[course ? { label: course.title, href: `/courses/${course.slug}` } : { label: t("quiz.page.crumbCourses"), href: "/courses" }, { label: assignment.title }]}
            />
          }
          title={assignment.title}
        />
        <EmptyState
          icon={<Icon.Lock />}
          title={t("assignment.page.locked")}
          description={gate.message}
          action={<ButtonLink href={gate.courseHref ?? "/courses"}>{gate.courseHref ? t("quiz.page.viewCourse") : t("quiz.page.browseCourses")}</ButtonLink>}
        />
      </div>
    );
  }
  // A lesson named in the URL only counts while the learner can open it.
  const lessonId = lessonParam && (privileged || gate?.openLessonIds.includes(lessonParam)) ? lessonParam : undefined;

  const own = await getOwnAssignmentSubmission(user.id, assignment.id);
  const back = await getReturnLink(lessonId ?? own?.lessonId, courseId);

  const crumbs: Crumb[] = privileged
    ? [
        { label: t("assignment.page.crumbAssignments"), href: "/admin/assignments" },
        { label: t("quiz.page.submissions"), href: `/admin/assignments/submissions?assignment=${assignment.id}` },
        { label: assignment.title },
      ]
    : [...(course ? [{ label: course.title, href: `/courses/${course.slug}` }] : [{ label: t("quiz.page.crumbCourses"), href: "/courses" }]), { label: assignment.title }];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        title={assignment.title}
        description={course ? t("assignment.page.forCourse", { course: course.title }) : t("assignment.page.metaTitle")}
        actions={
          back ? (
            <ButtonLink href={back.href} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}>
              {t("assignment.page.backTo", { title: back.label.replace(/^Back to /, "") })}
            </ButtonLink>
          ) : undefined
        }
      />
      <AssignmentPanel
        variant="page"
        assignment={toAssignmentView(assignment, { includeAnswer: !!own })}
        submission={own ? await toSubmissionView(own) : null}
        viewerName={user.name}
        loginHref={`/login?next=${encodeURIComponent(`/assignments/${assignment.id}`)}`}
        lessonId={lessonId}
        courseId={courseId}
        initialNow={new Date().getTime()}
        privileged={privileged}
        manageHref={privileged ? `/admin/assignments/submissions?assignment=${assignment.id}` : null}
      />
      <div className="mt-6">
        <AssignmentFeedback assignmentId={assignment.id} userId={user.id} privileged={privileged} />
      </div>
    </div>
  );
}

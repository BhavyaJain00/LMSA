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
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { AssignmentPanel } from "@/components/assessments/assignment-panel";
import { Breadcrumbs, type Crumb } from "@/components/assessments/breadcrumbs";
import { lessonQuery, param } from "@/components/assessments/shared";

export async function generateMetadata(props: PageProps<"/assignments/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const assignment = await getAssignment(id);
  return { title: assignment ? assignment.title : "Assignment" };
}

export default async function AssignmentPage(props: PageProps<"/assignments/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const lessonId = param(sp.lesson);
  const courseIdParam = param(sp.course);
  const user = await requireUser(`/assignments/${id}${lessonQuery(lessonId, courseIdParam)}`);

  const assignment = await getAssignment(id);
  if (!assignment) notFound();

  const db = await getDb();
  const courseId = courseIdParam ?? assignment.courseId;
  const course = courseId ? db.courses.find((c) => c.id === courseId) : undefined;
  const own = await getOwnAssignmentSubmission(user.id, assignment.id);
  const back = await getReturnLink(lessonId ?? own?.lessonId, courseId);
  const privileged = canManageAssessments(user);

  const crumbs: Crumb[] = privileged
    ? [
        { label: "Assignments", href: "/admin/assignments" },
        { label: "Submissions", href: `/admin/assignments/submissions?assignment=${assignment.id}` },
        { label: assignment.title },
      ]
    : [...(course ? [{ label: course.title, href: `/courses/${course.slug}` }] : [{ label: "Courses", href: "/courses" }]), { label: assignment.title }];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={crumbs} />}
        title={assignment.title}
        description={course ? `Assignment for ${course.title}` : "Assignment"}
        actions={
          back ? (
            <ButtonLink href={back.href} variant="outline" leftIcon={<Icon.ArrowLeft className="size-4" />}>
              {back.label}
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
    </div>
  );
}

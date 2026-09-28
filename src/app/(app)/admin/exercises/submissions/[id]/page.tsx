import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getExerciseSubmissionDetail } from "@/lib/data/assessments";
import { ExerciseSubmissionDetailView } from "@/components/assessments/exercise-submission-detail";

export const metadata: Metadata = { title: "Exercise submission" };

export default async function AdminExerciseSubmissionPage(props: PageProps<"/admin/exercises/submissions/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/admin/exercises/submissions/${id}`);
  if (!canManageAssessments(user)) redirect(`/exercises/submissions/${id}`);
  const detail = await getExerciseSubmissionDetail(id);
  if (!detail) notFound();
  const title = detail.exercise?.title ?? detail.submission.exerciseTitle;

  return (
    <ExerciseSubmissionDetailView
      detail={detail}
      staff
      owner={detail.submission.userId === user.id}
      crumbs={[
        { label: "Programming Exercises", href: "/admin/exercises" },
        { label: "Submissions", href: `/admin/exercises/submissions${detail.exercise ? `?exercise=${detail.exercise.id}` : ""}` },
        { label: title },
      ]}
    />
  );
}

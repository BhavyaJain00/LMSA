import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getExerciseSubmissionDetail } from "@/lib/data/assessments";
import { ExerciseSubmissionDetailView } from "@/components/assessments/exercise-submission-detail";

export const metadata: Metadata = { title: "Exercise submission" };

export default async function ExerciseSubmissionPage(props: PageProps<"/exercises/submissions/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/exercises/submissions/${id}`);
  const detail = await getExerciseSubmissionDetail(id);
  if (!detail) notFound();
  const staff = canManageAssessments(user);
  const owner = detail.submission.userId === user.id;
  if (!owner && !staff) redirect("/courses");
  const title = detail.exercise?.title ?? detail.submission.exerciseTitle;

  return (
    <ExerciseSubmissionDetailView
      detail={detail}
      staff={staff}
      owner={owner}
      crumbs={[{ label: "Programming Exercise Submissions", href: "/exercises/submissions" }, { label: title }]}
    />
  );
}

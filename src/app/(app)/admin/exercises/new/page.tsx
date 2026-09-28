import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getCourseOptions } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { ExerciseForm } from "@/components/assessments/exercise-form";
import { param } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "Create Programming Exercise" };

export default async function NewExercisePage(props: PageProps<"/admin/exercises/new">) {
  const user = await requireUser("/admin/exercises/new");
  if (!canManageAssessments(user)) redirect("/exercises/submissions");
  const sp = await props.searchParams;
  const courseOptions = await getCourseOptions(user);
  const course = param(sp.course);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Programming Exercises", href: "/admin/exercises" }, { label: "New" }]} />}
        title="Create Programming Exercise"
        description="Describe the problem, add starter code and at least one test case."
      />
      <ExerciseForm exercise={null} courseOptions={courseOptions} defaultCourseId={course && courseOptions.some((o) => o.value === course) ? course : undefined} />
    </div>
  );
}

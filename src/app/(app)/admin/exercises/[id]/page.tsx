import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getAssessmentUsage, getCourseOptions, getExercise, listExerciseSubmissions } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { ExerciseForm } from "@/components/assessments/exercise-form";

export async function generateMetadata(props: PageProps<"/admin/exercises/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const exercise = await getExercise(id);
  return { title: exercise ? `Edit ${exercise.title}` : "Edit Programming Exercise" };
}

export default async function EditExercisePage(props: PageProps<"/admin/exercises/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/admin/exercises/${id}`);
  if (!canManageAssessments(user)) redirect("/exercises/submissions");
  const exercise = await getExercise(id);
  if (!exercise) notFound();

  const [courseOptions, usage, submissions] = await Promise.all([
    getCourseOptions(user, exercise.courseId),
    getAssessmentUsage("exercise", exercise.id),
    listExerciseSubmissions({ exerciseId: exercise.id }),
  ]);
  const passed = submissions.filter((s) => s.status === "passed").length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Programming Exercises", href: "/admin/exercises" }, { label: exercise.title }]} />}
        title="Edit Programming Exercise"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{exercise.title}</span>
            <Link href={`/admin/exercises/submissions?exercise=${exercise.id}`} className="inline-flex items-center gap-1 text-accent hover:underline">
              <Icon.ClipboardList className="size-3.5" />
              {submissions.length} submission{submissions.length === 1 ? "" : "s"} · {passed} passed
            </Link>
            {usage.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Icon.BookOpen className="size-3.5" />
                Used in {usage.map((u) => u.lessonTitle).join(", ")}
              </span>
            )}
          </span>
        }
      />
      <ExerciseForm
        exercise={{
          id: exercise.id,
          title: exercise.title,
          language: exercise.language,
          courseId: exercise.courseId,
          problemStatement: exercise.problemStatement,
          starterCode: exercise.starterCode ?? "",
          testCases: exercise.testCases.map((t) => ({ id: t.id, input: t.input, expectedOutput: t.expectedOutput, hidden: !!t.hidden })),
        }}
        courseOptions={courseOptions}
      />
    </div>
  );
}

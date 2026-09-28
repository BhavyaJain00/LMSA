import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { manageableCourses } from "@/lib/data/quiz";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/quiz/shared";
import { QuizIcon } from "@/components/quiz/icons";
import { NewQuizForm } from "@/components/quiz/new-quiz-form";

export const metadata = { title: "New Quiz" };

export default async function NewQuizPage(props: PageProps<"/admin/quizzes/new">) {
  const user = await requireRole(["course_creator", "moderator"], "/admin/quizzes/new");
  const sp = await props.searchParams;
  const db = await getDb();
  const courses = manageableCourses(user, db);
  const requestedCourse = typeof sp.course === "string" ? sp.course : undefined;
  const defaultCourseId = requestedCourse && courses.some((c) => c.id === requestedCourse) ? requestedCourse : undefined;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Quizzes", href: "/admin/quizzes" }, { label: "New Quiz" }]} />}
        title="New Quiz"
        description="Name the quiz first. You'll add questions and fine-tune the settings in the builder."
      />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
        <Card>
          <CardBody>
            <NewQuizForm courses={courses} defaultCourseId={defaultCourseId} />
          </CardBody>
        </Card>
        <aside className="space-y-3 text-sm text-ink-muted">
          <p className="flex items-start gap-2">
            <QuizIcon.PencilLine className="mt-0.5 size-4 shrink-0 text-ink-faint" />
            The quiz is created as soon as you name it, then you can add questions right away.
          </p>
          <p className="flex items-start gap-2">
            <QuizIcon.Library className="mt-0.5 size-4 shrink-0 text-ink-faint" />
            Reuse questions from the shared question bank or write new ones inline.
          </p>
          <p className="flex items-start gap-2">
            <Icon.Sliders className="mt-0.5 size-4 shrink-0 text-ink-faint" />
            Attempts, time limit, negative marking, scheduling and proctoring live in the builder&apos;s settings panel.
          </p>
        </aside>
      </div>
    </div>
  );
}

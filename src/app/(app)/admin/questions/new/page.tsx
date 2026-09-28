import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/quiz/shared";
import { QuestionPageEditor } from "@/components/quiz/question-page-editor";

export const metadata = { title: "New question" };

export default async function NewQuestionPage() {
  await requireRole(["course_creator", "moderator"], "/admin/questions/new");
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Quizzes", href: "/admin/quizzes" }, { label: "Questions", href: "/admin/questions" }, { label: "New question" }]} />
        }
        title="New question"
        description="Questions live in the shared bank so you can reuse them in any quiz."
      />
      <QuestionPageEditor initial={null} canEdit usedIn={0} />
    </div>
  );
}

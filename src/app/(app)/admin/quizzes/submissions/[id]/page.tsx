import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser, requireRole } from "@/lib/auth/session";
import { getSubmissionDetail } from "@/lib/data/quiz";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/quiz/shared";
import { LocalTime } from "@/components/quiz/local-time";
import { SubmissionDetailView } from "@/components/quiz/submission-detail";

export async function generateMetadata(props: PageProps<"/admin/quizzes/submissions/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const user = await getCurrentUser();
  const data = user ? await getSubmissionDetail(user, id) : null;
  return { title: data ? (data.quiz?.title ?? data.submission.quizTitle) : "Quiz Submission" };
}

export default async function GradeSubmissionPage(props: PageProps<"/admin/quizzes/submissions/[id]">) {
  const { id } = await props.params;
  const user = await requireRole(["course_creator", "moderator"], `/admin/quizzes/submissions/${id}`);
  const data = await getSubmissionDetail(user, id);
  if (!data || !data.canManage) notFound();
  const { submission: s, quiz } = data;
  const learnerName = data.learner?.name ?? "Deleted user";

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Quizzes", href: "/admin/quizzes" },
              { label: "Submissions", href: quiz ? `/admin/quizzes/submissions?quiz=${quiz.id}` : "/admin/quizzes/submissions" },
              { label: learnerName },
            ]}
          />
        }
        title={quiz?.title ?? s.quizTitle}
        description={
          <>
            {learnerName} · attempt {data.attemptNumber} · submitted <LocalTime iso={s.submittedAt} />
          </>
        }
        actions={
          <>
            {quiz && data.canEditQuiz && (
              <ButtonLink href={`/admin/quizzes/${quiz.id}`} variant="subtle" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
                Edit quiz
              </ButtonLink>
            )}
            <ButtonLink
              href={quiz ? `/admin/quizzes/submissions?quiz=${quiz.id}` : "/admin/quizzes/submissions"}
              variant="outline"
              size="sm"
              leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />}
            >
              All submissions
            </ButtonLink>
          </>
        }
      />
      <SubmissionDetailView data={data} context="admin" />
    </div>
  );
}

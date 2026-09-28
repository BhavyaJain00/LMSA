import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, requireRole } from "@/lib/auth/session";
import { getQuestionDetail } from "@/lib/data/quiz";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { stripMarkdown, truncate } from "@/lib/utils";
import { Breadcrumbs, MarksBadge, QuestionTypeBadge } from "@/components/quiz/shared";
import { QuestionPageEditor } from "@/components/quiz/question-page-editor";
import { LocalTime } from "@/components/quiz/local-time";
import { questionToInput, toUiType } from "@/components/quiz/types";

export async function generateMetadata(props: PageProps<"/admin/questions/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const user = await getCurrentUser();
  const detail = user ? await getQuestionDetail(user, id) : null;
  return { title: detail ? truncate(stripMarkdown(detail.item.question.text), 60) : "Question" };
}

export default async function QuestionPage(props: PageProps<"/admin/questions/[id]">) {
  const { id } = await props.params;
  const user = await requireRole(["course_creator", "moderator"], `/admin/questions/${id}`);
  const detail = await getQuestionDetail(user, id);
  if (!detail) notFound();
  const { item, quizzes } = detail;
  const q = item.question;
  const title = truncate(stripMarkdown(q.text), 80) || "Untitled question";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Quizzes", href: "/admin/quizzes" }, { label: "Questions", href: "/admin/questions" }, { label: title }]} />}
        title="Question"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <QuestionTypeBadge type={toUiType(q.type, q.multiple)} />
            <MarksBadge marks={q.marks} />
            <span>
              Updated <LocalTime iso={q.updatedAt} format="date" />
            </span>
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <QuestionPageEditor key={q.updatedAt} initial={questionToInput(q)} canEdit={item.canEdit} usedIn={item.usedIn} authorName={item.authorName} />
        <aside className="space-y-4">
          <div className="rounded-card border border-border bg-surface-1 shadow-card">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">Used in</h2>
            {quizzes.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-muted">Not used in any quiz yet. Add it from a quiz&apos;s question bank panel.</p>
            ) : (
              <ul className="divide-y divide-border">
                {quizzes.map((quiz) => (
                  <li key={quiz.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <Icon.ListChecks className="size-4 shrink-0 text-ink-faint" />
                    {quiz.canManage ? (
                      <Link href={`/admin/quizzes/${quiz.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
                        {quiz.title}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-ink-muted">{quiz.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-card border border-border bg-surface-1 px-4 py-3 text-xs text-ink-muted shadow-card">
            <p>
              Written by <span className="font-medium text-ink">{item.authorName}</span>
            </p>
            <p className="mt-1">
              Created <LocalTime iso={q.createdAt} format="date" />
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

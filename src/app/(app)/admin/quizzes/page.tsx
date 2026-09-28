import { requireRole, isModerator } from "@/lib/auth/session";
import { listQuizzesForManager } from "@/lib/data/quiz";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/quiz/shared";
import { QuizIcon } from "@/components/quiz/icons";
import { LoadMore, SearchParamInput } from "@/components/quiz/list-controls";
import { QuizzesTable } from "@/components/quiz/quizzes-table";

export const metadata = { title: "Quizzes" };

const PAGE_SIZE = 24;

export default async function AdminQuizzesPage(props: PageProps<"/admin/quizzes">) {
  const user = await requireRole(["course_creator", "moderator"], "/admin/quizzes");
  const sp = await props.searchParams;
  const search = typeof sp.search === "string" ? sp.search : "";
  const limit = Math.max(PAGE_SIZE, Math.min(5000, Number(sp.limit) || PAGE_SIZE));
  const items = await listQuizzesForManager(user, search);
  const shown = items.slice(0, limit);

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Quizzes" }]} />}
        title={`${items.length} ${items.length === 1 ? "Quiz" : "Quizzes"}`}
        description="Build quizzes from the shared question bank, embed them in lessons and grade written answers."
        actions={
          <>
            <ButtonLink href="/admin/quizzes/submissions" variant="subtle" leftIcon={<QuizIcon.FileCheck className="size-4" />} aria-label="Submissions">
              <span className="hidden sm:inline">Submissions</span>
            </ButtonLink>
            <ButtonLink href="/admin/questions" variant="subtle" leftIcon={<Icon.Question className="size-4" />} aria-label="Questions">
              <span className="hidden sm:inline">Questions</span>
            </ButtonLink>
            <ButtonLink href="/admin/quizzes/new" leftIcon={<Icon.Plus className="size-4" />}>
              Create
            </ButtonLink>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchParamInput placeholder="Search" label="Search quizzes by title" />
      </div>
      {items.length === 0 ? (
        search ? (
          <EmptyState
            icon={<Icon.Search />}
            title="No quizzes match your search"
            description={`Nothing is titled like “${search}”. Try another word or clear the search.`}
            action={
              <ButtonLink href="/admin/quizzes" variant="outline">
                Clear search
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon.Question />}
            title="No Quizzes Found"
            description="There are no quizzes currently. Create your first quiz and add questions from the bank or write new ones."
            action={
              <ButtonLink href="/admin/quizzes/new" leftIcon={<Icon.Plus className="size-4" />}>
                Create quiz
              </ButtonLink>
            }
          />
        )
      ) : (
        <>
          <QuizzesTable items={shown} isModerator={isModerator(user)} />
          <LoadMore shown={shown.length} total={items.length} pageSize={PAGE_SIZE} />
        </>
      )}
    </div>
  );
}

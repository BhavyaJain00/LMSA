import { requireRole } from "@/lib/auth/session";
import { listQuestionBank } from "@/lib/data/quiz";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/quiz/shared";
import { ClearFiltersButton, FilterParamSelect, LoadMore, SearchParamInput } from "@/components/quiz/list-controls";
import { NewQuestionButton, QuestionBankTable } from "@/components/quiz/question-bank-table";
import { uiTypeLabels, uiTypes, type UiQuestionType } from "@/components/quiz/types";

export const metadata = { title: "Questions" };

const PAGE_SIZE = 24;

export default async function QuestionBankPage(props: PageProps<"/admin/questions">) {
  const user = await requireRole(["course_creator", "moderator"], "/admin/questions");
  const sp = await props.searchParams;
  const search = typeof sp.search === "string" ? sp.search : "";
  const type = typeof sp.type === "string" && uiTypes.includes(sp.type as UiQuestionType) ? (sp.type as UiQuestionType) : "";
  const limit = Math.max(PAGE_SIZE, Math.min(5000, Number(sp.limit) || PAGE_SIZE));
  const items = await listQuestionBank(user, { search, type });
  const shown = items.slice(0, limit);
  const filtered = !!search || !!type;

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Quizzes", href: "/admin/quizzes" }, { label: "Questions" }]} />}
        title="Questions"
        description={`${items.length} ${items.length === 1 ? "question" : "questions"} in the shared bank. Reuse them across quizzes; edits apply everywhere they are used.`}
        actions={<NewQuestionButton />}
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchParamInput placeholder="Search" label="Search questions" />
        <FilterParamSelect param="type" label="Filter by type" placeholder="All types" options={uiTypes.map((t) => ({ value: t, label: uiTypeLabels[t] }))} />
        <ClearFiltersButton params={["search", "type"]} />
      </div>
      {items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Icon.Search />}
            title="No questions match these filters"
            description="Try a different word or question type."
            action={
              <ButtonLink href="/admin/questions" variant="outline">
                Clear filters
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon.Question />}
            title="No Questions Found"
            description="There are no questions currently. Write your first question here or while building a quiz."
            action={<NewQuestionButton label="Create a question" />}
          />
        )
      ) : (
        <>
          <QuestionBankTable items={shown} />
          <LoadMore shown={shown.length} total={items.length} pageSize={PAGE_SIZE} />
        </>
      )}
    </div>
  );
}

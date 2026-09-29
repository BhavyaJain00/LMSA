import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getSubmissionFilterOptions, listQuizSubmissions, type SubmissionFilters } from "@/lib/data/quiz";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/quiz/shared";
import { QuizIcon } from "@/components/quiz/icons";
import { ClearFiltersButton, FilterParamSelect, LoadMore } from "@/components/quiz/list-controls";
import { SubmissionsTable } from "@/components/quiz/submissions-table";
import { submissionStatusLabels, type SubmissionStatus } from "@/components/quiz/types";

export const metadata = { title: "Quiz Submissions" };

const PAGE_SIZE = 24;
const STATUSES: SubmissionStatus[] = ["pending", "passed", "failed"];

export default async function QuizSubmissionsPage(props: PageProps<"/admin/quizzes/submissions">) {
  const user = await requireRole(["course_creator", "moderator"], "/admin/quizzes/submissions");
  const sp = await props.searchParams;
  const pick = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : "");
  const filters: SubmissionFilters = {
    quiz: pick("quiz") || undefined,
    member: pick("member") || undefined,
    course: pick("course") || undefined,
    status: STATUSES.includes(pick("status") as SubmissionStatus) ? (pick("status") as SubmissionStatus) : "",
  };
  const limit = Math.max(PAGE_SIZE, Math.min(10000, Number(sp.limit) || PAGE_SIZE));
  const [items, options] = await Promise.all([listQuizSubmissions(user, filters), getSubmissionFilterOptions(user)]);
  const shown = items.slice(0, limit);
  const filtered = !!(filters.quiz || filters.member || filters.course || filters.status);
  const pendingCount = filters.status ? null : items.filter((i) => i.status === "pending").length;

  const exportParams = new URLSearchParams();
  if (filters.quiz) exportParams.set("quiz", filters.quiz);
  if (filters.member) exportParams.set("member", filters.member);
  if (filters.course) exportParams.set("course", filters.course);
  if (filters.status) exportParams.set("status", filters.status);
  const exportQuery = exportParams.toString();
  const selectedQuiz = filters.quiz ? options.quizzes.find((q) => q.value === filters.quiz) : null;

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Quizzes", href: "/admin/quizzes" }, { label: "Submissions" }]} />}
        title="Submissions"
        description={
          selectedQuiz
            ? `Attempts for “${selectedQuiz.label}”. Open one to review answers and grade written responses.`
            : "Every attempt at the quizzes you manage and in the courses you teach. Open one to review answers and grade written responses."
        }
        actions={
          <>
            {selectedQuiz?.canEdit && (
              <ButtonLink href={`/admin/quizzes/${selectedQuiz.value}`} variant="subtle" leftIcon={<Icon.Edit className="size-4" />}>
                Edit quiz
              </ButtonLink>
            )}
            <a
              href={`/admin/quizzes/submissions/export${exportQuery ? `?${exportQuery}` : ""}`}
              download
              className={cn(buttonClasses({ variant: "outline" }), items.length === 0 && "pointer-events-none opacity-50")}
              aria-disabled={items.length === 0 || undefined}
            >
              <Icon.Download className="size-4" />
              Export CSV
            </a>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <FilterParamSelect param="quiz" label="Filter by Quiz" placeholder="Filter by Quiz" options={options.quizzes} className="sm:w-56" />
        <FilterParamSelect param="member" label="Filter by Member" placeholder="Filter by Member" options={options.members} />
        <FilterParamSelect param="course" label="Filter by Course" placeholder="Filter by Course" options={options.courses} className="sm:w-56" />
        <FilterParamSelect param="status" label="Filter by status" placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: submissionStatusLabels[s] }))} className="sm:w-44" />
        <ClearFiltersButton params={["quiz", "member", "course", "status"]} />
      </div>

      {pendingCount !== null && pendingCount > 0 && (
        <Link
          href={`/admin/quizzes/submissions?${new URLSearchParams({ ...(filters.quiz ? { quiz: filters.quiz } : {}), status: "pending" }).toString()}`}
          className="mb-4 flex items-center gap-2 rounded-xl border border-warning/35 bg-warning/10 px-4 py-2.5 text-sm text-ink hover:bg-warning/15"
        >
          <Icon.Clock className="size-4 text-warning" />
          <span className="flex-1">
            <span className="font-medium">{pendingCount}</span> {pendingCount === 1 ? "attempt is" : "attempts are"} waiting for grading
          </span>
          <Icon.ArrowRight className="size-4 text-ink-muted" />
        </Link>
      )}

      {items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Icon.Filter />}
            title="No submissions match these filters"
            description="Try another quiz, learner or course."
            action={
              <ButtonLink href="/admin/quizzes/submissions" variant="outline">
                Clear filters
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={<QuizIcon.FileCheck />}
            title="No Quiz Submissions Found"
            description="There are no quiz submissions currently. They appear here as soon as learners finish a quiz."
            action={
              <ButtonLink href="/admin/quizzes" variant="outline">
                View quizzes
              </ButtonLink>
            }
          />
        )
      ) : (
        <>
          <SubmissionsTable items={shown} />
          <LoadMore shown={shown.length} total={items.length} pageSize={PAGE_SIZE} />
        </>
      )}
    </div>
  );
}

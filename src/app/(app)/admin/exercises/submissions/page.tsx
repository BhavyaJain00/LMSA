import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isModerator, requireUser } from "@/lib/auth/session";
import { canManageAssessments, getExerciseOptions, getMemberOptions, listExerciseSubmissions } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { ExerciseSubmissionsTable } from "@/components/assessments/exercises-table";
import { param, parsePaging } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "Exercise Submissions" };

export default async function AdminExerciseSubmissionsPage(props: PageProps<"/admin/exercises/submissions">) {
  const user = await requireUser("/admin/exercises/submissions");
  if (!canManageAssessments(user)) redirect("/exercises/submissions");
  const sp = await props.searchParams;
  const exerciseId = param(sp.exercise);
  const memberId = param(sp.member);
  const status = param(sp.status);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [rows, exerciseOptions, memberOptions] = await Promise.all([
    listExerciseSubmissions({ exerciseId, memberId, status }),
    getExerciseOptions(),
    getMemberOptions(),
  ]);
  const shown = rows.slice(0, limit);
  const filtered = !!(exerciseId || memberId || status);
  const passed = rows.filter((r) => r.status === "passed").length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Programming Exercises", href: "/admin/exercises" }, { label: "Submissions" }]} />}
        title="Submissions"
        description={rows.length ? `${rows.length} submission${rows.length === 1 ? "" : "s"} · ${passed} passed` : "Learners' code submissions and their test results."}
        actions={
          exerciseId ? (
            <ButtonLink href={`/admin/exercises/${exerciseId}`} variant="outline" leftIcon={<Icon.Edit className="size-4" />}>
              Edit exercise
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        filters={[
          { param: "exercise", kind: "select", label: "Exercise", placeholder: "Filter by Exercise", options: exerciseOptions, className: "sm:w-64" },
          { param: "member", kind: "select", label: "Member", placeholder: "Filter by Member", options: memberOptions, className: "sm:w-64" },
          {
            param: "status",
            kind: "select",
            label: "Status",
            placeholder: "Filter by Status",
            options: [
              { value: "passed", label: "Passed" },
              { value: "failed", label: "Failed" },
            ],
          },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.FileText />}
          title={filtered ? "No submissions match these filters" : "No Programming Exercise Submissions Found"}
          description={
            filtered
              ? "Try clearing a filter to see more submissions."
              : "There are no programming exercise submissions currently. Keep an eye out, fresh learning experiences are on the way!"
          }
        />
      ) : (
        <>
          <ExerciseSubmissionsTable rows={shown} canDelete={isModerator(user)} />
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} noun="submissions" />
        </>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canManageAssessments, getCourseOptions, listExercises } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { ExercisesTable } from "@/components/assessments/exercises-table";
import { LANGUAGE_OPTIONS, param, parsePaging } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "Programming Exercises" };

export default async function AdminExercisesPage(props: PageProps<"/admin/exercises">) {
  const user = await requireUser("/admin/exercises");
  if (!canManageAssessments(user)) redirect("/exercises/submissions");
  const sp = await props.searchParams;
  const title = param(sp.title);
  const language = param(sp.language);
  const courseId = param(sp.course);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [rows, courseOptions, settings] = await Promise.all([listExercises({ search: title, language, courseId }), getCourseOptions(user), getSettings()]);
  const shown = rows.slice(0, limit);
  const filtered = !!(title || language || courseId);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Programming Exercises" }]} />}
        title={`${rows.length} ${rows.length === 1 ? "Exercise" : "Exercises"}`}
        description="Coding challenges graded automatically against your test cases."
        actions={
          <>
            {rows.length > 0 && (
              <ButtonLink href="/admin/exercises/submissions" variant="outline" className="hidden sm:inline-flex" leftIcon={<Icon.ClipboardList className="size-4" />}>
                Check All Submissions
              </ButtonLink>
            )}
            <ButtonLink href="/admin/exercises/new" leftIcon={<Icon.Plus className="size-4" />}>
              Create
            </ButtonLink>
          </>
        }
      />
      {!settings.features.programmingExercises && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Programming exercises are turned off in Settings → Features, so learners can&apos;t open them right now.
        </p>
      )}
      <FilterBar
        filters={[
          { param: "title", kind: "search", label: "Search", placeholder: "Search" },
          { param: "language", kind: "select", label: "Language", placeholder: "Language", options: LANGUAGE_OPTIONS },
          { param: "course", kind: "select", label: "Course", placeholder: "All courses", options: courseOptions },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.Code />}
          title={filtered ? "No exercises match these filters" : "No Programming Exercises Found"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "There are no programming exercises currently. Keep an eye out, fresh learning experiences are on the way!"
          }
          action={
            <ButtonLink href="/admin/exercises/new" leftIcon={<Icon.Plus className="size-4" />}>
              Create an exercise
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ExercisesTable rows={shown} />
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} noun="exercises" />
        </>
      )}
    </div>
  );
}

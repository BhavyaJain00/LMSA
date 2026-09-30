import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getCourseOptions, listAssignments } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { AssignmentsTable } from "@/components/assessments/assignments-table";
import { ASSIGNMENT_TYPE_OPTIONS, param, parsePaging } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "Assignments" };

export default async function AdminAssignmentsPage(props: PageProps<"/admin/assignments">) {
  const user = await requireUser("/admin/assignments");
  if (!canManageAssessments(user)) redirect("/courses");
  const sp = await props.searchParams;
  const title = param(sp.title);
  const type = param(sp.type);
  const courseId = param(sp.course);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [rows, courseOptions] = await Promise.all([listAssignments({ search: title, type, courseId }), getCourseOptions(user)]);
  const shown = rows.slice(0, limit);
  const filtered = !!(title || type || courseId);
  const pending = rows.reduce((n, r) => n + r.pendingCount, 0);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Assignments" }]} />}
        title={`${rows.length} ${rows.length === 1 ? "Assignment" : "Assignments"}`}
        description={pending > 0 ? `${pending} submission${pending === 1 ? "" : "s"} waiting to be graded.` : "Create assignments, embed them in lessons and grade learner submissions."}
        actions={
          <>
            <ButtonLink href="/admin/rubrics" variant="outline" leftIcon={<Icon.ListChecks className="size-4" />}>
              Rubrics
            </ButtonLink>
            <ButtonLink href="/peer-reviews/manage" variant="outline" leftIcon={<Icon.Users className="size-4" />}>
              Peer reviews
            </ButtonLink>
            <ButtonLink href="/admin/assignments/submissions" variant="outline" leftIcon={<Icon.ClipboardList className="size-4" />}>
              Submissions
            </ButtonLink>
            <ButtonLink href="/admin/assignments/new" leftIcon={<Icon.Plus className="size-4" />}>
              Create
            </ButtonLink>
          </>
        }
      />
      <FilterBar
        filters={[
          { param: "title", kind: "search", label: "Search", placeholder: "Search" },
          { param: "type", kind: "select", label: "Type", placeholder: "Type", options: ASSIGNMENT_TYPE_OPTIONS },
          { param: "course", kind: "select", label: "Course", placeholder: "All courses", options: courseOptions },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.ClipboardList />}
          title={filtered ? "No assignments match these filters" : "No Assignments Found"}
          description={
            filtered
              ? "Try a different search or clear the filters."
              : "There are no assignments currently. Keep an eye out, fresh learning experiences are on the way!"
          }
          action={
            <ButtonLink href="/admin/assignments/new" leftIcon={<Icon.Plus className="size-4" />}>
              Create an assignment
            </ButtonLink>
          }
        />
      ) : (
        <>
          <AssignmentsTable rows={shown} />
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} noun="assignments" />
        </>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getExerciseOptions, listExerciseSubmissions } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { LinkRow } from "@/components/assessments/link-row";
import { ExerciseStatusBadge } from "@/components/assessments/status-badges";
import { RelativeTime } from "@/components/assessments/client-time";
import { LANGUAGE_LABELS, param, parsePaging } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "My exercise submissions" };

export default async function MyExerciseSubmissionsPage(props: PageProps<"/exercises/submissions">) {
  const sp = await props.searchParams;
  const user = await requireUser("/exercises/submissions");
  const exerciseId = param(sp.exercise);
  const status = param(sp.status);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [rows, exerciseOptions] = await Promise.all([listExerciseSubmissions({ exerciseId, status, memberId: user.id }), getExerciseOptions()]);
  const shown = rows.slice(0, limit);
  const filtered = !!(exerciseId || status);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Programming Exercise Submissions" }]} />}
        title="Submissions"
        description="Your code submissions for programming exercises and their latest test results."
        actions={
          canManageAssessments(user) ? (
            <ButtonLink href="/admin/exercises/submissions" variant="outline" leftIcon={<Icon.ClipboardList className="size-4" />}>
              All learners&apos; submissions
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        filters={[
          { param: "exercise", kind: "select", label: "Exercise", placeholder: "Filter by Exercise", options: exerciseOptions },
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
          icon={<Icon.Code />}
          title={filtered ? "No submissions match these filters" : "No Programming Exercise Submissions Found"}
          description={
            filtered
              ? "Try clearing the filters to see all of your submissions."
              : "There are no programming exercise submissions currently. Keep an eye out, fresh learning experiences are on the way!"
          }
          action={!filtered ? <ButtonLink href="/courses">Browse courses</ButtonLink> : undefined}
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Exercise</TH>
                <TH className="hidden sm:table-cell">Language</TH>
                <TH>Status</TH>
                <TH className="hidden sm:table-cell">Tests</TH>
                <TH className="text-right">Modified</TH>
              </tr>
            </THead>
            <TBody>
              {shown.map((row) => (
                <LinkRow key={row.id} href={`/exercises/submissions/${row.id}`}>
                  <TD className="font-medium">
                    <Link href={`/exercises/submissions/${row.id}`} className="hover:underline">
                      {row.exerciseTitle}
                    </Link>
                  </TD>
                  <TD className="hidden text-ink-muted sm:table-cell">{row.language ? LANGUAGE_LABELS[row.language] : "—"}</TD>
                  <TD>
                    <ExerciseStatusBadge status={row.status} />
                  </TD>
                  <TD className="hidden text-ink-muted sm:table-cell">
                    {row.passedCount}/{row.totalCount}
                  </TD>
                  <TD className="text-right text-xs text-ink-muted">
                    <RelativeTime iso={row.submittedAt} />
                  </TD>
                </LinkRow>
              ))}
            </TBody>
          </Table>
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} noun="submissions" />
        </>
      )}
    </div>
  );
}

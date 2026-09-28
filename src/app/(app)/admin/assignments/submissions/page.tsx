import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getAssignmentOptions, getMemberOptions, listAssignmentSubmissions } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { LinkRow } from "@/components/assessments/link-row";
import { AssignmentStatusBadge } from "@/components/assessments/status-badges";
import { RelativeTime } from "@/components/assessments/client-time";
import { ASSIGNMENT_STATUS_OPTIONS, ASSIGNMENT_TYPE_LABELS, param, parsePaging } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "Assignment Submissions" };

export default async function AssignmentSubmissionsPage(props: PageProps<"/admin/assignments/submissions">) {
  const user = await requireUser("/admin/assignments/submissions");
  if (!canManageAssessments(user)) redirect("/courses");
  const sp = await props.searchParams;
  const assignmentId = param(sp.assignment);
  const memberId = param(sp.member);
  const status = param(sp.status);
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [rows, assignmentOptions, memberOptions] = await Promise.all([
    listAssignmentSubmissions({ assignmentId, memberId, status }),
    getAssignmentOptions(),
    getMemberOptions(),
  ]);
  const shown = rows.slice(0, limit);
  const filtered = !!(assignmentId || memberId || status);
  const pending = rows.filter((r) => r.status === "not_graded").length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Assignments", href: "/admin/assignments" }, { label: "Submissions" }]} />}
        title="Assignment Submissions"
        description={
          rows.length
            ? `${rows.length} submission${rows.length === 1 ? "" : "s"}${pending ? ` · ${pending} not graded yet` : " · all graded"}`
            : "Every learner submission, ready for grading."
        }
        actions={
          assignmentId ? (
            <ButtonLink href={`/admin/assignments/${assignmentId}`} variant="outline" leftIcon={<Icon.Edit className="size-4" />}>
              Edit assignment
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        filters={[
          { param: "assignment", kind: "select", label: "Assignment", placeholder: "Assignment", options: assignmentOptions, className: "sm:w-64" },
          { param: "member", kind: "select", label: "Member", placeholder: "Member", options: memberOptions, className: "sm:w-64" },
          { param: "status", kind: "select", label: "Status", placeholder: "Status", options: ASSIGNMENT_STATUS_OPTIONS },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.Edit />}
          title={filtered ? "No submissions match these filters" : "No Assignment Submissions Found"}
          description={
            filtered
              ? "Try clearing a filter to see more submissions."
              : "There are no assignment submissions currently. Keep an eye out, fresh learning experiences are on the way!"
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon.User className="size-3.5" /> Member
                  </span>
                </TH>
                <TH>Assignment</TH>
                <TH className="hidden md:table-cell">Submitted</TH>
                <TH className="text-right sm:text-left">Status</TH>
              </tr>
            </THead>
            <TBody>
              {shown.map((row) => (
                <LinkRow key={row.id} href={`/admin/assignments/submissions/${row.id}`}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={row.user.name} src={row.user.avatarUrl} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/admin/assignments/submissions/${row.id}`} className="block truncate font-medium text-ink hover:underline">
                          {row.user.name}
                        </Link>
                        <p className="truncate text-xs text-ink-muted md:hidden">
                          <RelativeTime iso={row.submittedAt} />
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <p className="font-medium text-ink">{row.assignmentTitle}</p>
                    <p className="text-xs text-ink-muted">
                      {ASSIGNMENT_TYPE_LABELS[row.type]}
                      {row.courseTitle ? ` · ${row.courseTitle}` : ""}
                    </p>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-sm text-ink-muted md:table-cell">
                    <RelativeTime iso={row.submittedAt} />
                  </TD>
                  <TD className="text-right sm:text-left">
                    <AssignmentStatusBadge status={row.status} />
                    {row.evaluatorName && <p className="mt-1 hidden text-xs text-ink-faint lg:block">by {row.evaluatorName}</p>}
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

"use client";

import Link from "next/link";
import type { AssignmentListRow } from "@/lib/data/assessments";
import { deleteAssignmentsAction } from "@/lib/actions/assignments";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { LinkRow } from "./link-row";
import { BulkDeleteBar, RowCheckbox, SelectAllCheckbox, useSelection } from "./bulk-actions";
import { ASSIGNMENT_TYPE_LABELS } from "./shared";
import { formatShortDate } from "@/components/certificates/time";

export function AssignmentsTable({ rows }: { rows: AssignmentListRow[] }) {
  const selection = useSelection(rows.map((r) => r.id));
  return (
    <>
      <BulkDeleteBar
        selected={selection.selected}
        onClear={selection.clear}
        action={deleteAssignmentsAction}
        noun="assignment"
        confirmDescription="Deleting these assignments will permanently remove them from the system, along with all associated submissions. This action is irreversible. Are you sure you want to proceed?"
      />
      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <SelectAllCheckbox checked={selection.allSelected} indeterminate={selection.someSelected} onChange={selection.toggleAll} />
            </TH>
            <TH>
              <span className="inline-flex items-center gap-1.5">
                <Icon.FileText className="size-3.5" /> Title
              </span>
            </TH>
            <TH className="hidden sm:table-cell">
              <span className="inline-flex items-center gap-1.5">
                <Icon.Tag className="size-3.5" /> Type
              </span>
            </TH>
            <TH className="hidden md:table-cell">Submissions</TH>
            <TH className="text-right">
              <span className="inline-flex items-center gap-1.5">
                <Icon.Clock className="size-3.5" /> Updated On
              </span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <LinkRow key={row.id} href={`/admin/assignments/${row.id}`} className={selection.isSelected(row.id) ? "bg-accent/5" : undefined}>
              <TD className="w-10">
                <RowCheckbox checked={selection.isSelected(row.id)} onChange={() => selection.toggle(row.id)} label={`Select ${row.title}`} />
              </TD>
              <TD>
                <Link href={`/admin/assignments/${row.id}`} className="font-medium text-ink hover:underline">
                  {row.title}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  {row.courseTitle ?? "No course"}
                  <span className="sm:hidden">· {ASSIGNMENT_TYPE_LABELS[row.type]}</span>
                  {row.scheduled && (
                    <span className="inline-flex items-center gap-1">
                      <Icon.Calendar className="size-3" /> Scheduled
                    </span>
                  )}
                </p>
              </TD>
              <TD className="hidden sm:table-cell">
                <Badge tone="outline">{ASSIGNMENT_TYPE_LABELS[row.type]}</Badge>
              </TD>
              <TD className="hidden md:table-cell">
                <Link href={`/admin/assignments/submissions?assignment=${row.id}`} className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
                  {row.submissionCount}
                  {row.pendingCount > 0 && (
                    <Badge tone="info" size="xs">
                      {row.pendingCount} to grade
                    </Badge>
                  )}
                </Link>
              </TD>
              <TD className="whitespace-nowrap text-right text-xs text-ink-muted">{formatShortDate(row.updatedAt.slice(0, 10))}</TD>
            </LinkRow>
          ))}
        </TBody>
      </Table>
    </>
  );
}

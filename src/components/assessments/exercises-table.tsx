"use client";

import Link from "next/link";
import type { ExerciseListRow, ExerciseSubmissionRow } from "@/lib/data/assessments";
import { deleteExerciseSubmissionsAction, deleteExercisesAction } from "@/lib/actions/exercises";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { formatShortDate } from "@/components/certificates/time";
import { LinkRow } from "./link-row";
import { BulkDeleteBar, RowCheckbox, SelectAllCheckbox, useSelection } from "./bulk-actions";
import { ExerciseStatusBadge } from "./status-badges";
import { RelativeTime } from "./client-time";
import { LANGUAGE_LABELS } from "./shared";

export function ExercisesTable({ rows }: { rows: ExerciseListRow[] }) {
  const selection = useSelection(rows.map((r) => r.id));
  return (
    <>
      <BulkDeleteBar
        selected={selection.selected}
        onClear={selection.clear}
        action={deleteExercisesAction}
        noun="exercise"
        confirmDescription="Deleting these exercises will permanently remove them from the system, along with all associated submissions. This action is irreversible. Are you sure you want to proceed?"
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
                <Icon.Code className="size-3.5" /> Language
              </span>
            </TH>
            <TH className="hidden md:table-cell">Tests</TH>
            <TH className="hidden lg:table-cell">Submissions</TH>
            <TH className="text-right">
              <span className="inline-flex items-center gap-1.5">
                <Icon.Clock className="size-3.5" /> Updated On
              </span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <LinkRow key={row.id} href={`/admin/exercises/${row.id}`} className={selection.isSelected(row.id) ? "bg-accent/5" : undefined}>
              <TD className="w-10">
                <RowCheckbox checked={selection.isSelected(row.id)} onChange={() => selection.toggle(row.id)} label={`Select ${row.title}`} />
              </TD>
              <TD>
                <Link href={`/admin/exercises/${row.id}`} className="font-medium text-ink hover:underline">
                  {row.title}
                </Link>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {row.courseTitle ?? "No course"}
                  <span className="sm:hidden"> · {LANGUAGE_LABELS[row.language]}</span>
                </p>
              </TD>
              <TD className="hidden sm:table-cell">
                <Badge tone="outline">{LANGUAGE_LABELS[row.language]}</Badge>
              </TD>
              <TD className="hidden text-sm text-ink-muted md:table-cell">
                {row.testCount}
                {row.hiddenCount > 0 && <span className="text-xs text-ink-faint"> ({row.hiddenCount} hidden)</span>}
              </TD>
              <TD className="hidden lg:table-cell">
                <Link href={`/admin/exercises/submissions?exercise=${row.id}`} className="text-sm text-ink-muted hover:text-ink">
                  {row.submissionCount === 0 ? "None yet" : `${row.passedCount} passed / ${row.submissionCount}`}
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

export function ExerciseSubmissionsTable({ rows, canDelete }: { rows: ExerciseSubmissionRow[]; canDelete: boolean }) {
  const selection = useSelection(rows.map((r) => r.id));
  return (
    <>
      {canDelete && (
        <BulkDeleteBar
          selected={selection.selected}
          onClear={selection.clear}
          action={deleteExerciseSubmissionsAction}
          noun="submission"
          confirmDescription="The selected submissions and their test results will be permanently removed. Learners can submit again."
        />
      )}
      <Table>
        <THead>
          <tr>
            {canDelete && (
              <TH className="w-10">
                <SelectAllCheckbox checked={selection.allSelected} indeterminate={selection.someSelected} onChange={selection.toggleAll} />
              </TH>
            )}
            <TH>
              <span className="inline-flex items-center gap-1.5">
                <Icon.User className="size-3.5" /> Member
              </span>
            </TH>
            <TH className="hidden sm:table-cell">
              <span className="inline-flex items-center gap-1.5">
                <Icon.Code className="size-3.5" /> Exercise
              </span>
            </TH>
            <TH>
              <span className="inline-flex items-center gap-1.5">
                <Icon.CheckCircle className="size-3.5" /> Status
              </span>
            </TH>
            <TH className="hidden md:table-cell">Tests</TH>
            <TH className="text-right">
              <span className="inline-flex items-center gap-1.5">
                <Icon.Clock className="size-3.5" /> Modified
              </span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <LinkRow key={row.id} href={`/admin/exercises/submissions/${row.id}`} className={selection.isSelected(row.id) ? "bg-accent/5" : undefined}>
              {canDelete && (
                <TD className="w-10">
                  <RowCheckbox checked={selection.isSelected(row.id)} onChange={() => selection.toggle(row.id)} label={`Select submission by ${row.user.name}`} />
                </TD>
              )}
              <TD>
                <div className="flex items-center gap-2.5">
                  <Avatar name={row.user.name} src={row.user.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <Link href={`/admin/exercises/submissions/${row.id}`} className="block truncate font-medium text-ink hover:underline">
                      {row.user.name}
                    </Link>
                    <p className="truncate text-xs text-ink-muted sm:hidden">{row.exerciseTitle}</p>
                  </div>
                </div>
              </TD>
              <TD className="hidden sm:table-cell">
                <p className="text-ink">{row.exerciseTitle}</p>
                {row.language && <p className="text-xs text-ink-muted">{LANGUAGE_LABELS[row.language]}</p>}
              </TD>
              <TD>
                <ExerciseStatusBadge status={row.status} />
              </TD>
              <TD className="hidden text-sm text-ink-muted md:table-cell">
                {row.passedCount}/{row.totalCount}
              </TD>
              <TD className="whitespace-nowrap text-right text-xs text-ink-muted">
                <RelativeTime iso={row.submittedAt} />
              </TD>
            </LinkRow>
          ))}
        </TBody>
      </Table>
    </>
  );
}

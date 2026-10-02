"use client";

import Link from "next/link";
import type { AssignmentListRow } from "@/lib/data/assessments";
import { deleteAssignmentsAction } from "@/lib/actions/assignments";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { LinkRow } from "./link-row";
import { BulkDeleteBar, RowCheckbox, SelectAllCheckbox, useSelection } from "./bulk-actions";
import { formatShortDate } from "@/components/certificates/time";
import { useLocale, useT } from "@/i18n/client";

export function AssignmentsTableView({ rows }: { rows: AssignmentListRow[] }) {
  const t = useT("learning");
  const locale = useLocale();
  const selection = useSelection(rows.map((r) => r.id));
  return (
    <>
      <BulkDeleteBar
        selected={selection.selected}
        onClear={selection.clear}
        action={deleteAssignmentsAction}
        confirmTitle={t("assessAdmin.assignments.confirmTitle", { count: selection.selected.length })}
        confirmDescription={t("assessAdmin.assignments.confirmBody")}
      />
      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <SelectAllCheckbox checked={selection.allSelected} indeterminate={selection.someSelected} onChange={selection.toggleAll} />
            </TH>
            <TH>
              <span className="inline-flex items-center gap-1.5">
                <Icon.FileText className="size-3.5" /> {t("assessAdmin.col.title")}
              </span>
            </TH>
            <TH className="hidden sm:table-cell">
              <span className="inline-flex items-center gap-1.5">
                <Icon.Tag className="size-3.5" /> {t("assessAdmin.col.type")}
              </span>
            </TH>
            <TH className="hidden md:table-cell">{t("assessAdmin.col.submissions")}</TH>
            <TH className="text-end">
              <span className="inline-flex items-center gap-1.5">
                <Icon.Clock className="size-3.5" /> {t("assessAdmin.col.updated")}
              </span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <LinkRow key={row.id} href={`/admin/assignments/${row.id}`} className={selection.isSelected(row.id) ? "bg-accent/5" : undefined}>
              <TD className="w-10">
                <RowCheckbox checked={selection.isSelected(row.id)} onChange={() => selection.toggle(row.id)} label={t("assessAdmin.selectRow", { title: row.title })} />
              </TD>
              <TD>
                <Link href={`/admin/assignments/${row.id}`} className="font-medium text-ink hover:underline">
                  {row.title}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  {row.courseTitle ?? t("assessAdmin.noCourse")}
                  <span className="sm:hidden">· {t(`global.assess.type.${row.type}`)}</span>
                  {row.scheduled && (
                    <span className="inline-flex items-center gap-1">
                      <Icon.Calendar className="size-3" /> {t("assessAdmin.scheduled")}
                    </span>
                  )}
                </p>
              </TD>
              <TD className="hidden sm:table-cell">
                <Badge tone="outline">{t(`global.assess.type.${row.type}`)}</Badge>
              </TD>
              <TD className="hidden md:table-cell">
                <Link href={`/admin/assignments/submissions?assignment=${row.id}`} className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
                  {row.submissionCount}
                  {row.pendingCount > 0 && (
                    <Badge tone="info" size="xs">
                      {t("assessAdmin.toGrade", { count: row.pendingCount })}
                    </Badge>
                  )}
                </Link>
              </TD>
              <TD className="whitespace-nowrap text-end text-xs text-ink-muted">{formatShortDate(row.updatedAt.slice(0, 10), locale)}</TD>
            </LinkRow>
          ))}
        </TBody>
      </Table>
    </>
  );
}

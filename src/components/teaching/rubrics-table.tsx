"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RubricListRow } from "@/lib/teaching/rubrics";
import { deleteRubricsAction, duplicateRubricAction } from "@/lib/actions/rubrics";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { LinkRow } from "@/components/assessments/link-row";
import { BulkDeleteBar, RowCheckbox, SelectAllCheckbox, useSelection } from "@/components/assessments/bulk-actions";
import { LocalDateTime } from "@/components/assessments/client-time";
import { formatPoints } from "@/lib/teaching/rubric-shared";

/** Duplicate button (list rows and the rubric page): copies the rubric and opens the copy. */
export function DuplicateRubricButton({ id, title, variant = "icon" }: { id: string; title: string; variant?: "icon" | "button" }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await duplicateRubricAction(id);
      if (!res.ok) {
        toast({ title: res.error, tone: "error" });
        return;
      }
      toast({ title: res.message ?? "Rubric duplicated", tone: "success" });
      router.push(`/admin/rubrics/${res.data.id}`);
    });
  if (variant === "button") {
    return (
      <Button variant="outline" onClick={run} loading={pending} leftIcon={<Icon.Copy className="size-4" />}>
        Duplicate
      </Button>
    );
  }
  return (
    <IconButton label={`Duplicate ${title}`} size="icon-sm" onClick={run} loading={pending}>
      <Icon.Copy className="size-4" />
    </IconButton>
  );
}

/** Delete button for the rubric page (disabled while assignments use it). */
export function DeleteRubricButton({ id, inUse }: { id: string; inUse: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="outline"
        className="text-danger"
        onClick={() => setOpen(true)}
        disabled={inUse > 0}
        title={inUse > 0 ? "Detach this rubric from its assignments before deleting it" : undefined}
        leftIcon={<Icon.Trash className="size-4" />}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this rubric?"
        description="The rubric is removed permanently. Assignments no longer use it, so no graded work is affected."
        confirmLabel="Delete"
        destructive
        loading={pending}
        onConfirm={() =>
          start(async () => {
            const res = await deleteRubricsAction([id]);
            if (!res.ok) {
              toast({ title: res.error, tone: "error" });
              return;
            }
            toast({ title: res.message ?? "Rubric deleted", tone: "success" });
            setOpen(false);
            router.push("/admin/rubrics");
          })
        }
      />
    </>
  );
}

export function RubricsTable({ rows }: { rows: RubricListRow[] }) {
  const selection = useSelection(rows.filter((r) => r.editable).map((r) => r.id));
  return (
    <>
      <BulkDeleteBar
        selected={selection.selected}
        onClear={selection.clear}
        action={deleteRubricsAction}
        noun="rubric"
        confirmDescription="The selected rubrics are removed permanently. Rubrics still attached to an assignment are kept; detach them from the assignment first."
      />
      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <SelectAllCheckbox checked={selection.allSelected} indeterminate={selection.someSelected} onChange={selection.toggleAll} label="Select all rubrics you can delete" />
            </TH>
            <TH>Rubric</TH>
            <TH className="hidden sm:table-cell">Points</TH>
            <TH className="hidden md:table-cell">Used by</TH>
            <TH className="hidden lg:table-cell">Updated</TH>
            <TH className="w-12">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <LinkRow key={row.id} href={`/admin/rubrics/${row.id}`} className={selection.isSelected(row.id) ? "bg-accent/5" : undefined}>
              <TD className="w-10">
                {row.editable ? (
                  <RowCheckbox checked={selection.isSelected(row.id)} onChange={() => selection.toggle(row.id)} label={`Select ${row.title}`} />
                ) : (
                  <Icon.Lock className="size-3.5 text-ink-faint" aria-label="Owned by someone else" />
                )}
              </TD>
              <TD>
                <Link href={`/admin/rubrics/${row.id}`} className="font-medium text-ink hover:underline">
                  {row.title}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                  {row.criteriaCount} {row.criteriaCount === 1 ? "criterion" : "criteria"}
                  <span className="sm:hidden">· {formatPoints(row.maxPoints)} pts</span>
                  <span>· by {row.mine ? "you" : row.authorName}</span>
                </p>
              </TD>
              <TD className="hidden whitespace-nowrap sm:table-cell">
                <span className="font-medium tabular-nums text-ink">{formatPoints(row.maxPoints)} pts</span>
                <p className="text-xs text-ink-muted">Pass at {row.passPercent}%</p>
              </TD>
              <TD className="hidden md:table-cell">
                {row.assignmentCount ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-ink">
                    {row.assignmentCount} {row.assignmentCount === 1 ? "assignment" : "assignments"}
                    {row.gradedCount > 0 && (
                      <Badge tone="info" size="xs">
                        {row.gradedCount} graded
                      </Badge>
                    )}
                  </span>
                ) : (
                  <span className="text-sm text-ink-faint">Not used yet</span>
                )}
              </TD>
              <TD className="hidden whitespace-nowrap text-xs text-ink-muted lg:table-cell">
                <LocalDateTime iso={row.updatedAt} mode="date" />
              </TD>
              <TD className="w-12 text-right">
                <DuplicateRubricButton id={row.id} title={row.title} />
              </TD>
            </LinkRow>
          ))}
        </TBody>
      </Table>
    </>
  );
}

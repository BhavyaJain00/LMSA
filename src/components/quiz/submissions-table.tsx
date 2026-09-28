"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteSubmissionsAction } from "@/lib/actions/quiz";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { LocalTime } from "./local-time";
import { SelectAllCheckbox, SelectionBar } from "./list-controls";
import { SubmissionStatusBadge } from "./shared";
import { formatPercent, formatScore, type SubmissionListItem } from "./types";

export function SubmissionsTable({ items }: { items: SubmissionListItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const ids = items.map((i) => i.id);
  const selectedVisible = selected.filter((id) => ids.includes(id));
  const allChecked = ids.length > 0 && selectedVisible.length === ids.length;
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    const target = selectedVisible;
    try {
      const res = await deleteSubmissionsAction(target);
      if (!res.ok) {
        toast({ title: res.error, tone: "error" });
        return;
      }
      if (res.data.failed > 0) {
        toast({ title: `${res.data.failed} of ${target.length} submissions could not be deleted`, description: "You can only delete submissions of quizzes you manage.", tone: "warning" });
      } else {
        toast({ title: "Submissions deleted successfully", tone: "success" });
      }
      setSelected([]);
      setConfirm(false);
      router.refresh();
    } catch {
      toast({ title: "Could not delete the selected submissions. Please try again.", tone: "error" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <SelectionBar count={selectedVisible.length} onClear={() => setSelected([])}>
        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setConfirm(true)} disabled={deleting} leftIcon={<Icon.Trash className={cn("size-4", deleting && "opacity-60")} />}>
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </SelectionBar>
      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <SelectAllCheckbox
                label="Select all submissions"
                checked={allChecked}
                indeterminate={selectedVisible.length > 0 && !allChecked}
                onChange={() => setSelected(allChecked ? [] : ids)}
              />
            </TH>
            <TH>Learner</TH>
            <TH className="hidden md:table-cell">Quiz</TH>
            <TH className="hidden xl:table-cell">Course</TH>
            <TH className="text-right">Score</TH>
            <TH className="hidden text-right sm:table-cell">%</TH>
            <TH className="hidden lg:table-cell">Status</TH>
            <TH className="hidden text-right lg:table-cell">Violations</TH>
            <TH className="hidden text-right md:table-cell">Submitted</TH>
          </tr>
        </THead>
        <TBody>
          {items.map((s) => {
            const checked = selected.includes(s.id);
            const href = `/admin/quizzes/submissions/${s.id}`;
            return (
              <TR key={s.id} clickable className={cn(checked && "bg-accent/5")} onClick={() => router.push(href)}>
                <TD onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(s.id)} aria-label={`Select submission by ${s.learnerName}`} className="size-4 cursor-pointer accent-accent" />
                </TD>
                <TD className="max-w-[16rem]">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={s.learnerName} src={s.learnerAvatar} size="sm" />
                    <div className="min-w-0">
                      <Link href={href} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-ink hover:underline">
                        {s.learnerName}
                      </Link>
                      <p className="truncate text-xs text-ink-muted md:hidden">{s.quizTitle}</p>
                      <p className="hidden truncate text-xs text-ink-muted md:block">{s.learnerEmail}</p>
                    </div>
                  </div>
                </TD>
                <TD className="hidden max-w-[14rem] truncate md:table-cell">{s.quizTitle}</TD>
                <TD className="hidden max-w-[12rem] truncate text-ink-muted xl:table-cell">{s.courseTitle ?? "—"}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">
                  {s.status === "pending" ? (
                    <span className="text-xs font-medium text-warning lg:hidden">Pending</span>
                  ) : null}
                  <span className={cn(s.status === "pending" && "hidden lg:inline")}>
                    {formatScore(s.score)} / {formatScore(s.scoreOutOf)}
                  </span>
                </TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{formatPercent(s.percentage)}</TD>
                <TD className="hidden lg:table-cell">
                  <SubmissionStatusBadge status={s.status} />
                </TD>
                <TD className={cn("hidden text-right tabular-nums lg:table-cell", s.violationCount > 0 ? "font-medium text-danger" : "text-ink-faint")}>{s.violationCount}</TD>
                <TD className="hidden whitespace-nowrap text-right text-ink-muted md:table-cell">
                  <LocalTime iso={s.submittedAt} format="date" />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <ConfirmDialog
        open={confirm}
        onClose={() => (deleting ? undefined : setConfirm(false))}
        onConfirm={remove}
        loading={deleting}
        destructive
        confirmLabel="Delete"
        title={selectedVisible.length === 1 ? "Delete this submission?" : `Delete ${selectedVisible.length} submissions?`}
        description="Deleted attempts no longer count towards the learner's attempts or scores. Their proctoring logs are removed too. This action cannot be undone."
      />
    </>
  );
}

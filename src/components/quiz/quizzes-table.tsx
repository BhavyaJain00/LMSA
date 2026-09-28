"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteQuizzesAction } from "@/lib/actions/quiz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { LocalTime } from "./local-time";
import { SelectAllCheckbox, SelectionBar } from "./list-controls";
import { formatScore, type QuizListItem } from "./types";

export function QuizzesTable({ items, isModerator }: { items: QuizListItem[]; isModerator: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const visibleIds = items.map((i) => i.id);
  const selectedVisible = selected.filter((id) => visibleIds.includes(id));
  const allChecked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const withSubmissions = items.filter((i) => selectedVisible.includes(i.id) && i.submissionCount > 0).length;

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    const ids = selectedVisible;
    try {
      const res = await deleteQuizzesAction(ids);
      if (!res.ok) {
        toast({ title: `Error deleting ${ids.length === 1 ? "quiz" : "quizzes"}: ${res.error}`, tone: "error" });
        return;
      }
      const { deleted, failed } = res.data;
      const reason = failed.map((f) => `${f.title} (${f.error})`).join(", ");
      if (deleted === 0) {
        toast({ title: `Error deleting ${ids.length === 1 ? "quiz" : "quizzes"}: ${reason}`, tone: "error" });
      } else if (failed.length) {
        toast({ title: `${deleted} of ${ids.length} quizzes deleted; the rest remain selected`, description: reason, tone: "warning" });
      } else {
        toast({ title: deleted === 1 ? "Quiz deleted successfully" : `${deleted} quizzes deleted successfully`, tone: "success" });
      }
      setSelected(failed.map((f) => f.id));
      setConfirm(false);
      router.refresh();
    } catch {
      toast({ title: "Could not delete the selected quizzes. Please try again.", tone: "error" });
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
                label="Select all quizzes"
                checked={allChecked}
                indeterminate={selectedVisible.length > 0 && !allChecked}
                onChange={() => setSelected(allChecked ? [] : visibleIds)}
              />
            </TH>
            <TH>Title</TH>
            <TH className="hidden text-right md:table-cell">Questions</TH>
            <TH className="hidden text-right md:table-cell">Total marks</TH>
            <TH className="hidden text-right lg:table-cell">Passing %</TH>
            <TH className="hidden text-right lg:table-cell">Max attempts</TH>
            <TH className="hidden text-center xl:table-cell">Show answers</TH>
            <TH className="text-right">Submissions</TH>
            <TH className="hidden text-right sm:table-cell">Updated on</TH>
          </tr>
        </THead>
        <TBody>
          {items.map((q) => {
            const checked = selected.includes(q.id);
            return (
              <TR key={q.id} clickable className={cn(checked && "bg-accent/5")} onClick={() => router.push(`/admin/quizzes/${q.id}`)}>
                <TD onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(q.id)} aria-label={`Select ${q.title}`} className="size-4 cursor-pointer accent-accent" />
                </TD>
                <TD className="max-w-[18rem]">
                  <Link href={`/admin/quizzes/${q.id}`} className="block truncate font-medium text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                    {q.title}
                  </Link>
                  <p className="truncate text-xs text-ink-muted">
                    {q.courseTitle ?? "Not linked to a course"}
                    <span className="md:hidden"> · {q.questionCount} questions</span>
                  </p>
                </TD>
                <TD className="hidden text-right tabular-nums md:table-cell">{q.questionCount}</TD>
                <TD className="hidden text-right tabular-nums md:table-cell">{formatScore(q.totalMarks)}</TD>
                <TD className="hidden text-right tabular-nums lg:table-cell">{formatScore(q.passingPercentage)}%</TD>
                <TD className="hidden text-right tabular-nums lg:table-cell">{q.maxAttempts === 0 ? "Unlimited" : q.maxAttempts}</TD>
                <TD className="hidden text-center xl:table-cell">
                  <input type="checkbox" checked={q.showAnswers} disabled readOnly aria-label={q.showAnswers ? "Shows answers" : "Hides answers"} className="size-4 accent-accent" />
                </TD>
                <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Link href={`/admin/quizzes/submissions?quiz=${q.id}`} className="inline-flex items-center gap-1.5 tabular-nums text-ink hover:underline">
                    {q.submissionCount}
                    {q.pendingGradingCount > 0 && (
                      <Badge tone="warning" size="xs">
                        {q.pendingGradingCount} to grade
                      </Badge>
                    )}
                  </Link>
                </TD>
                <TD className="hidden whitespace-nowrap text-right text-ink-muted sm:table-cell">
                  <LocalTime iso={q.updatedAt} format="date" />
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
        title={selectedVisible.length === 1 ? "Delete this quiz?" : `Delete ${selectedVisible.length} quizzes?`}
        description={
          withSubmissions > 0
            ? isModerator
              ? `Deleting permanently removes the selected quizzes and all of their submissions (${withSubmissions} of them have learner attempts). This action cannot be undone.`
              : `Quizzes that learners have already taken can only be deleted by a moderator and will stay. The others are removed permanently.`
            : "Deleting permanently removes the selected quizzes and removes them from any lessons. This action cannot be undone."
        }
      />
    </>
  );
}

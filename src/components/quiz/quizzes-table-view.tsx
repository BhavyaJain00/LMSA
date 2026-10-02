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
import { useT } from "@/i18n/client";
import { LocalTime } from "./local-time";
import { SelectAllCheckbox, SelectionBar } from "./list-controls";
import { formatScore, type QuizListItem } from "./types";

export function QuizzesTableView({ items, isModerator }: { items: QuizListItem[]; isModerator: boolean }) {
  const t = useT("learning");
  const tc = useT("common");
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
        toast({ title: t("quizAdmin.quizzes.deleteError", { count: ids.length, error: res.error }), tone: "error" });
        return;
      }
      const { deleted, failed } = res.data;
      const reason = failed.map((f) => `${f.title} (${f.error})`).join(", ");
      if (deleted === 0) {
        toast({ title: t("quizAdmin.quizzes.deleteError", { count: ids.length, error: reason }), tone: "error" });
      } else if (failed.length) {
        toast({ title: t("quizAdmin.quizzes.partlyDeleted", { deleted, total: ids.length }), description: reason, tone: "warning" });
      } else {
        toast({ title: t("quizAdmin.quizzes.deleted", { count: deleted }), tone: "success" });
      }
      setSelected(failed.map((f) => f.id));
      setConfirm(false);
      router.refresh();
    } catch {
      toast({ title: t("quizAdmin.quizzes.deleteFailed"), tone: "error" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <SelectionBar count={selectedVisible.length} onClear={() => setSelected([])}>
        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setConfirm(true)} disabled={deleting} leftIcon={<Icon.Trash className={cn("size-4", deleting && "opacity-60")} />}>
          {deleting ? t("quizAdmin.common.deleting") : tc("actions.delete")}
        </Button>
      </SelectionBar>
      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <SelectAllCheckbox
                label={t("quizAdmin.quizzes.selectAll")}
                checked={allChecked}
                indeterminate={selectedVisible.length > 0 && !allChecked}
                onChange={() => setSelected(allChecked ? [] : visibleIds)}
              />
            </TH>
            <TH>{t("quizAdmin.quizzes.colTitle")}</TH>
            <TH className="hidden text-end md:table-cell">{t("quizAdmin.quizzes.colQuestions")}</TH>
            <TH className="hidden text-end md:table-cell">{t("quizAdmin.quizzes.colTotalMarks")}</TH>
            <TH className="hidden text-end lg:table-cell">{t("quizAdmin.quizzes.colPassing")}</TH>
            <TH className="hidden text-end lg:table-cell">{t("quizAdmin.quizzes.colMaxAttempts")}</TH>
            <TH className="hidden text-center xl:table-cell">{t("quizAdmin.quizzes.colShowAnswers")}</TH>
            <TH className="text-end">{t("quizAdmin.quizzes.colSubmissions")}</TH>
            <TH className="hidden text-end sm:table-cell">{t("quizAdmin.quizzes.colUpdated")}</TH>
          </tr>
        </THead>
        <TBody>
          {items.map((q) => {
            const checked = selected.includes(q.id);
            return (
              <TR key={q.id} clickable className={cn(checked && "bg-accent/5")} onClick={() => router.push(`/admin/quizzes/${q.id}`)}>
                <TD onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(q.id)} aria-label={t("quizAdmin.common.selectRow", { title: q.title })} className="size-4 cursor-pointer accent-accent" />
                </TD>
                <TD className="max-w-[18rem]">
                  <Link href={`/admin/quizzes/${q.id}`} className="block truncate font-medium text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                    {q.title}
                  </Link>
                  <p className="truncate text-xs text-ink-muted">
                    {q.courseTitle ?? t("quizAdmin.quizzes.noCourse")}
                    <span className="md:hidden"> · {t("quizAdmin.quizzes.questionCount", { count: q.questionCount })}</span>
                  </p>
                </TD>
                <TD className="hidden text-end tabular-nums md:table-cell">{q.questionCount}</TD>
                <TD className="hidden text-end tabular-nums md:table-cell">{formatScore(q.totalMarks)}</TD>
                <TD className="hidden text-end tabular-nums lg:table-cell">{formatScore(q.passingPercentage)}%</TD>
                <TD className="hidden text-end tabular-nums lg:table-cell">{q.maxAttempts === 0 ? t("quizAdmin.quizzes.unlimited") : q.maxAttempts}</TD>
                <TD className="hidden text-center xl:table-cell">
                  <input type="checkbox" checked={q.showAnswers} disabled readOnly aria-label={q.showAnswers ? t("quizAdmin.quizzes.showsAnswers") : t("quizAdmin.quizzes.hidesAnswers")} className="size-4 accent-accent" />
                </TD>
                <TD className="text-end" onClick={(e) => e.stopPropagation()}>
                  <Link href={`/admin/quizzes/submissions?quiz=${q.id}`} className="inline-flex items-center gap-1.5 tabular-nums text-ink hover:underline">
                    {q.submissionCount}
                    {q.pendingGradingCount > 0 && (
                      <Badge tone="warning" size="xs">
                        {t("quizAdmin.quizzes.toGrade", { count: q.pendingGradingCount })}
                      </Badge>
                    )}
                  </Link>
                </TD>
                <TD className="hidden whitespace-nowrap text-end text-ink-muted sm:table-cell">
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
        confirmLabel={tc("actions.delete")}
        title={t("quizAdmin.quizzes.confirmTitle", { count: selectedVisible.length })}
        description={
          withSubmissions > 0
            ? isModerator
              ? t("quizAdmin.quizzes.confirmModerator", { count: withSubmissions })
              : t("quizAdmin.quizzes.confirmCreator")
            : t("quizAdmin.quizzes.confirmBody")
        }
      />
    </>
  );
}

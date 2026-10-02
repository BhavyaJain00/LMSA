"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteQuestionsAction } from "@/lib/actions/questions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn, stripMarkdown, truncate } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { LocalTime } from "./local-time";
import { SelectAllCheckbox, SelectionBar } from "./list-controls";
import { QuestionDialog } from "./question-dialog";
import { MarksBadge, QuestionTypeBadge } from "./shared";
import { questionToInput, toUiType, type QuestionBankItem } from "./types";

/** "New question" header button with its own dialog. */
export function NewQuestionButtonView({ label }: { label?: string }) {
  const t = useT("learning");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        leftIcon={<Icon.Plus className="size-4" />}
      >
        {label ?? t("quizAdmin.question.new")}
      </Button>
      {open && (
        <QuestionDialog
          key={key}
          open={open}
          onClose={() => setOpen(false)}
          initial={null}
          canEdit
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}

export function QuestionBankTableView({ items }: { items: QuestionBankItem[] }) {
  const t = useT("learning");
  const tc = useT("common");
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<QuestionBankItem | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const ids = items.map((i) => i.question.id);
  const selectedVisible = selected.filter((id) => ids.includes(id));
  const allChecked = ids.length > 0 && selectedVisible.length === ids.length;
  const inUse = items.filter((i) => selectedVisible.includes(i.question.id) && i.usedIn > 0).length;
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    const target = selectedVisible;
    try {
      const res = await deleteQuestionsAction(target);
      if (!res.ok) {
        toast({ title: t("quizAdmin.bank.deleteError", { count: target.length, error: res.error }), tone: "error" });
        return;
      }
      const { deleted, failed } = res.data;
      const reason = Array.from(new Set(failed.map((f) => f.error))).join("; ");
      if (deleted === 0) toast({ title: t("quizAdmin.bank.deleteError", { count: target.length, error: reason }), tone: "error" });
      else if (failed.length) toast({ title: t("quizAdmin.bank.partlyDeleted", { deleted, total: target.length }), description: reason, tone: "warning" });
      else toast({ title: t("quizAdmin.bank.deleted", { count: deleted }), tone: "success" });
      setSelected(failed.map((f) => f.id));
      setConfirm(false);
      router.refresh();
    } catch {
      toast({ title: t("quizAdmin.bank.deleteFailed"), tone: "error" });
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
                label={t("quizAdmin.bank.selectAll")}
                checked={allChecked}
                indeterminate={selectedVisible.length > 0 && !allChecked}
                onChange={() => setSelected(allChecked ? [] : ids)}
              />
            </TH>
            <TH>{t("quizAdmin.bank.colQuestion")}</TH>
            <TH className="hidden md:table-cell">{t("quizAdmin.bank.colType")}</TH>
            <TH className="hidden text-end lg:table-cell">{t("quizAdmin.bank.colMarks")}</TH>
            <TH className="hidden text-end sm:table-cell">{t("quizAdmin.bank.colUsedIn")}</TH>
            <TH className="hidden lg:table-cell">{t("quizAdmin.bank.colAuthor")}</TH>
            <TH className="hidden text-end md:table-cell">{t("quizAdmin.quizzes.colUpdated")}</TH>
            <TH className="w-10">
              <span className="sr-only">{t("quizAdmin.bank.colOpen")}</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {items.map((item) => {
            const q = item.question;
            const checked = selected.includes(q.id);
            const uiType = toUiType(q.type, q.multiple);
            const plain = stripMarkdown(q.text) || t("quizAdmin.bank.untitled");
            return (
              <TR key={q.id} clickable className={cn(checked && "bg-accent/5")} onClick={() => setEditing(item)}>
                <TD onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(q.id)} aria-label={t("quizAdmin.bank.selectRow", { title: truncate(plain, 60) })} className="size-4 cursor-pointer accent-accent" />
                </TD>
                <TD className="max-w-[28rem]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(item);
                    }}
                    className="block max-w-full truncate text-start font-medium text-ink hover:underline"
                    title={plain}
                  >
                    {truncate(plain, 140)}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted md:hidden">
                    <QuestionTypeBadge type={uiType} />
                    <span>{item.usedIn > 0 ? t("quizAdmin.bank.inQuizzes", { count: item.usedIn }) : t("quizAdmin.bank.notUsed")}</span>
                  </p>
                </TD>
                <TD className="hidden md:table-cell">
                  <QuestionTypeBadge type={uiType} />
                </TD>
                <TD className="hidden text-end lg:table-cell">
                  <MarksBadge marks={q.marks} />
                </TD>
                <TD className="hidden text-end tabular-nums sm:table-cell">
                  {item.usedIn > 0 ? (
                    <Badge tone={item.usedIn > 1 ? "warning" : "neutral"}>{t("quizAdmin.bank.quizCount", { count: item.usedIn })}</Badge>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </TD>
                <TD className="hidden max-w-[10rem] truncate text-ink-muted lg:table-cell">{item.authorName}</TD>
                <TD className="hidden whitespace-nowrap text-end text-ink-muted md:table-cell">
                  <LocalTime iso={q.updatedAt} format="date" />
                </TD>
                <TD onClick={(e) => e.stopPropagation()}>
                  <Link href={`/admin/questions/${q.id}`} aria-label={t("quizAdmin.bank.openPage")} title={t("quizAdmin.bank.openPage")} className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink">
                    <Icon.ArrowUpRight className="size-4 rtl:-scale-x-100" />
                  </Link>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      {editing && (
        <QuestionDialog
          key={editing.question.id + editing.question.updatedAt}
          open
          onClose={() => setEditing(null)}
          initial={questionToInput(editing.question)}
          canEdit={editing.canEdit}
          authorName={editing.authorName}
          usedIn={editing.usedIn}
          onSaved={() => router.refresh()}
        />
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => (deleting ? undefined : setConfirm(false))}
        onConfirm={remove}
        loading={deleting}
        destructive
        confirmLabel={tc("actions.delete")}
        title={t("quizAdmin.bank.confirmTitle", { count: selectedVisible.length })}
        description={inUse > 0 ? t("quizAdmin.bank.confirmInUse", { count: inUse }) : t("quizAdmin.bank.confirmBody")}
      />
    </>
  );
}

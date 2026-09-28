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
import { LocalTime } from "./local-time";
import { SelectAllCheckbox, SelectionBar } from "./list-controls";
import { QuestionDialog } from "./question-dialog";
import { MarksBadge, QuestionTypeBadge } from "./shared";
import { questionToInput, toUiType, type QuestionBankItem } from "./types";

/** "New question" header button with its own dialog. */
export function NewQuestionButton({ label = "New question" }: { label?: string }) {
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
        {label}
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

export function QuestionBankTable({ items }: { items: QuestionBankItem[] }) {
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
        toast({ title: `Error deleting ${target.length === 1 ? "question" : "questions"}: ${res.error}`, tone: "error" });
        return;
      }
      const { deleted, failed } = res.data;
      const reason = Array.from(new Set(failed.map((f) => f.error))).join("; ");
      if (deleted === 0) toast({ title: `Error deleting ${target.length === 1 ? "question" : "questions"}: ${reason}`, tone: "error" });
      else if (failed.length) toast({ title: `${deleted} of ${target.length} questions deleted; the rest remain selected`, description: reason, tone: "warning" });
      else toast({ title: deleted === 1 ? "Question deleted successfully" : `${deleted} questions deleted successfully`, tone: "success" });
      setSelected(failed.map((f) => f.id));
      setConfirm(false);
      router.refresh();
    } catch {
      toast({ title: "Could not delete the selected questions. Please try again.", tone: "error" });
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
                label="Select all questions"
                checked={allChecked}
                indeterminate={selectedVisible.length > 0 && !allChecked}
                onChange={() => setSelected(allChecked ? [] : ids)}
              />
            </TH>
            <TH>Question</TH>
            <TH className="hidden md:table-cell">Type</TH>
            <TH className="hidden text-right lg:table-cell">Marks</TH>
            <TH className="hidden text-right sm:table-cell">Used in</TH>
            <TH className="hidden lg:table-cell">Author</TH>
            <TH className="hidden text-right md:table-cell">Updated on</TH>
            <TH className="w-10">
              <span className="sr-only">Open</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {items.map((item) => {
            const q = item.question;
            const checked = selected.includes(q.id);
            const uiType = toUiType(q.type, q.multiple);
            const plain = stripMarkdown(q.text) || "Untitled question";
            return (
              <TR key={q.id} clickable className={cn(checked && "bg-accent/5")} onClick={() => setEditing(item)}>
                <TD onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(q.id)} aria-label={`Select question: ${truncate(plain, 60)}`} className="size-4 cursor-pointer accent-accent" />
                </TD>
                <TD className="max-w-[28rem]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(item);
                    }}
                    className="block max-w-full truncate text-left font-medium text-ink hover:underline"
                    title={plain}
                  >
                    {truncate(plain, 140)}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted md:hidden">
                    <QuestionTypeBadge type={uiType} />
                    <span>{item.usedIn > 0 ? `In ${item.usedIn} ${item.usedIn === 1 ? "quiz" : "quizzes"}` : "Not used yet"}</span>
                  </p>
                </TD>
                <TD className="hidden md:table-cell">
                  <QuestionTypeBadge type={uiType} />
                </TD>
                <TD className="hidden text-right lg:table-cell">
                  <MarksBadge marks={q.marks} />
                </TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">
                  {item.usedIn > 0 ? (
                    <Badge tone={item.usedIn > 1 ? "warning" : "neutral"}>{item.usedIn === 1 ? "1 quiz" : `${item.usedIn} quizzes`}</Badge>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </TD>
                <TD className="hidden max-w-[10rem] truncate text-ink-muted lg:table-cell">{item.authorName}</TD>
                <TD className="hidden whitespace-nowrap text-right text-ink-muted md:table-cell">
                  <LocalTime iso={q.updatedAt} format="date" />
                </TD>
                <TD onClick={(e) => e.stopPropagation()}>
                  <Link href={`/admin/questions/${q.id}`} aria-label="Open question page" title="Open question page" className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink">
                    <Icon.ArrowUpRight className="size-4" />
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
        confirmLabel="Delete"
        title={selectedVisible.length === 1 ? "Delete this question?" : `Delete ${selectedVisible.length} questions?`}
        description={
          inUse > 0
            ? `${inUse === 1 ? "One selected question is" : `${inUse} selected questions are`} still used in a quiz and will be kept. Remove them from their quizzes first. Everything else is deleted permanently.`
            : "The selected questions are deleted from the question bank permanently. This action cannot be undone."
        }
      />
    </>
  );
}

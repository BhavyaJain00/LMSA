"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteClarificationAction } from "@/lib/actions/ai";
import { Markdown } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { relativeTime } from "@/lib/utils";

export interface DetachedClarificationItem {
  id: string;
  courseTitle: string;
  lessonTitle?: string;
  text: string;
  authorName?: string;
  updatedAt: string;
}

/**
 * Instructor clarifications whose conversation the learner deleted. They
 * still teach the tutor; staff can remove the ones that no longer apply.
 */
export function DetachedClarifications({ items }: { items: DetachedClarificationItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<DetachedClarificationItem | null>(null);

  if (!items.length) return null;

  const remove = () => {
    const target = confirm;
    if (!target) return;
    startTransition(async () => {
      const result = await deleteClarificationAction(target.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Clarification removed");
      setConfirm(null);
      router.refresh();
    });
  };

  return (
    <section className="mt-8" aria-labelledby="detached-clarifications-heading">
      <h2 id="detached-clarifications-heading" className="text-base font-semibold text-ink">
        Clarifications from deleted conversations
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        The learner deleted these conversations, but your corrections are course knowledge: the tutor keeps using them for future questions. Remove the ones that no longer apply.
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-border bg-surface-1 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 text-xs text-ink-faint">
                <span className="font-medium text-ink-muted">{item.courseTitle}</span>
                {item.lessonTitle && <> · {item.lessonTitle}</>}
                {" · "}
                {item.authorName ? `${item.authorName}, ` : ""}
                <time dateTime={item.updatedAt}>{relativeTime(item.updatedAt)}</time>
              </p>
              <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setConfirm(item)} leftIcon={<Icon.Trash className="size-4" />}>
                Remove
              </Button>
            </div>
            <Markdown content={item.text} className="mt-2 text-sm" />
          </li>
        ))}
      </ul>

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Remove this clarification?"
        description="The tutor stops using it for future questions. This can't be undone."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} loading={pending} leftIcon={<Icon.Trash className="size-4" />}>
              Remove
            </Button>
          </>
        }
      >
        {confirm && <p className="line-clamp-6 whitespace-pre-wrap break-words text-sm text-ink-muted">{confirm.text}</p>}
      </Dialog>
    </section>
  );
}

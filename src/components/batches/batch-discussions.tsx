"use client";

import { useState, useSyncExternalStore } from "react";
import { Markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import {
  createBatchTopicAction,
  deleteBatchReplyAction,
  deleteBatchTopicAction,
  replyBatchTopicAction,
  updateBatchReplyAction,
} from "@/lib/actions/batches";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useActionForm, useServerAction } from "./hooks";
import type { DiscussionThread, ReplyView } from "./types";
import { useFormatter, useT } from "@/i18n/client";

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function useHash(): string {
  return useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
}

function NewTopicForm({ batchId, onDone }: { batchId: string; onDone: () => void }) {
  const t = useT("public");
  const common = useT("common");
  const { onSubmit, pending, error, fieldErrors } = useActionForm(createBatchTopicAction, { onSuccess: onDone });
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <input type="hidden" name="batchId" value={batchId} />
      <FormError message={error} />
      <Field label={t("batches.discussions.titleLabel")} htmlFor="topic-title" required error={fieldErrors.title}>
        <Input id="topic-title" name="title" required maxLength={200} placeholder={t("batches.discussions.titlePlaceholder")} invalid={!!fieldErrors.title} autoFocus />
      </Field>
      <Field label={t("batches.discussions.messageLabel")} htmlFor="topic-content" required error={fieldErrors.content} hint={t("batches.discussions.messageHint")}>
        <Textarea id="topic-content" name="content" rows={5} required invalid={!!fieldErrors.content} placeholder={t("batches.discussions.messagePlaceholder")} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          {common("actions.cancel")}
        </Button>
        <Button type="submit" loading={pending} leftIcon={<Icon.Send className="size-4" />}>
          {t("batches.discussions.post")}
        </Button>
      </div>
    </form>
  );
}

function ReplyForm({ topicId }: { topicId: string }) {
  const t = useT("public");
  const [formKey, setFormKey] = useState(0);
  const { onSubmit, pending, error, fieldErrors } = useActionForm(replyBatchTopicAction, { onSuccess: () => setFormKey((k) => k + 1), toast: false });
  return (
    <form key={formKey} onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="topicId" value={topicId} />
      <FormError message={error && !fieldErrors.content ? error : null} />
      <label htmlFor={`reply-${topicId}`} className="sr-only">
        {t("batches.discussions.yourReply")}
      </label>
      <Textarea id={`reply-${topicId}`} name="content" rows={3} placeholder={t("batches.discussions.replyPlaceholder")} invalid={!!fieldErrors.content} required />
      {fieldErrors.content && <p className="text-xs text-danger">{fieldErrors.content}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending} leftIcon={<Icon.Send className="size-4" />}>
          {t("batches.discussions.reply")}
        </Button>
      </div>
    </form>
  );
}

function ReplyItem({ reply, canEdit, canDelete, onDelete }: { reply: ReplyView; canEdit: boolean; canDelete: boolean; onDelete: (id: string) => void }) {
  const t = useT("public");
  const common = useT("common");
  const f = useFormatter();
  const [editing, setEditing] = useState(false);
  const { onSubmit, pending, error } = useActionForm(updateBatchReplyAction, { onSuccess: () => setEditing(false) });
  const edited = reply.updatedAt > reply.createdAt;
  return (
    <li className="flex gap-3">
      <Avatar name={reply.author?.name ?? t("batches.discussions.member")} src={reply.author?.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium text-ink">{reply.author?.name ?? t("batches.discussions.formerMember")}</span>
          <time dateTime={reply.createdAt} title={f.dateTime(reply.createdAt)} className="text-xs text-ink-muted" suppressHydrationWarning>
            {f.relative(reply.createdAt)}
          </time>
          {edited && <span className="text-xs text-ink-faint">{t("batches.discussions.edited")}</span>}
          {!editing && (canEdit || canDelete) && (
            <span className="ms-auto flex gap-0.5">
              {canEdit && (
                <IconButton label={t("batches.discussions.editReply")} size="icon-sm" onClick={() => setEditing(true)}>
                  <Icon.Edit className="size-3.5" />
                </IconButton>
              )}
              {canDelete && (
                <IconButton label={t("batches.discussions.deleteReply")} size="icon-sm" onClick={() => onDelete(reply.id)} className="hover:text-danger">
                  <Icon.Trash className="size-3.5" />
                </IconButton>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <form onSubmit={onSubmit} className="mt-2 space-y-2">
            <input type="hidden" name="replyId" value={reply.id} />
            <FormError message={error} />
            <label htmlFor={`edit-${reply.id}`} className="sr-only">
              {t("batches.discussions.editReply")}
            </label>
            <Textarea id={`edit-${reply.id}`} name="content" rows={4} defaultValue={reply.content} required autoFocus />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
                {common("actions.cancel")}
              </Button>
              <Button size="sm" type="submit" loading={pending}>
                {common("actions.save")}
              </Button>
            </div>
          </form>
        ) : (
          <Markdown content={reply.content} className="mt-1 text-sm" />
        )}
      </div>
    </li>
  );
}

/** Batch discussion board: topics with threaded replies, open to enrolled learners and instructors. */
export function BatchDiscussions({
  batchId,
  threads,
  viewerId,
  canModerate,
}: {
  batchId: string;
  threads: DiscussionThread[];
  viewerId: string;
  canModerate: boolean;
}) {
  const t = useT("public");
  const common = useT("common");
  const f = useFormatter();
  const hash = useHash();
  const [composing, setComposing] = useState(false);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<{ kind: "topic" | "reply"; id: string } | null>(null);
  const { pending, run } = useServerAction();

  const isOpen = (id: string, index: number) => toggled[id] ?? (hash === `#topic-${id}` || (index === 0 && !hash.startsWith("#topic-")));

  const doDelete = () => {
    if (!confirm) return;
    const target = confirm;
    run(() => (target.kind === "topic" ? deleteBatchTopicAction(target.id) : deleteBatchReplyAction(target.id)), { onSuccess: () => setConfirm(null) });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("batches.discussions.title")}</h2>
          <p className="text-sm text-ink-muted">{t("batches.discussions.description")}</p>
        </div>
        {!composing && (
          <Button onClick={() => setComposing(true)} leftIcon={<Icon.Plus className="size-4" />}>
            {t("batches.discussions.newTopic")}
          </Button>
        )}
      </div>

      {composing && <NewTopicForm batchId={batchId} onDone={() => setComposing(false)} />}

      {threads.length === 0 && !composing ? (
        <EmptyState
          icon={<Icon.MessageCircle />}
          title={t("batches.discussions.emptyTitle")}
          description={t("batches.discussions.emptyDescription")}
          action={
            <Button onClick={() => setComposing(true)} leftIcon={<Icon.Plus className="size-4" />}>
              {t("batches.discussions.start")}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {threads.map((topic, index) => {
            const open = isOpen(topic.id, index);
            const canDeleteTopic = topic.authorId === viewerId || canModerate;
            return (
              <li key={topic.id} id={`topic-${topic.id}`} className="scroll-mt-24 overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
                <div className="flex items-start gap-3 p-4">
                  <Avatar name={topic.author?.name ?? t("batches.discussions.member")} src={topic.author?.avatarUrl} size="sm" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-start"
                    aria-expanded={open}
                    aria-controls={`topic-body-${topic.id}`}
                    onClick={() => setToggled((s) => ({ ...s, [topic.id]: !open }))}
                  >
                    <span className="block font-semibold text-ink hover:text-accent">{topic.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted" suppressHydrationWarning>
                      {topic.author?.name ?? t("batches.discussions.formerMember")} · {f.relative(topic.createdAt)} · {t("batches.discussions.replyCount", { count: Math.max(0, topic.replies.length - 1) })}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {canDeleteTopic && (
                      <IconButton label={t("batches.discussions.deleteTopic")} size="icon-sm" onClick={() => setConfirm({ kind: "topic", id: topic.id })} className="hover:text-danger">
                        <Icon.Trash className="size-4" />
                      </IconButton>
                    )}
                    <IconButton label={open ? t("batches.discussions.collapse") : t("batches.discussions.expand")} size="icon-sm" onClick={() => setToggled((s) => ({ ...s, [topic.id]: !open }))}>
                      <Icon.ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                    </IconButton>
                  </div>
                </div>
                {open && (
                  <div id={`topic-body-${topic.id}`} className="space-y-4 border-t border-border bg-surface-2/40 p-4">
                    {topic.replies.length > 0 ? (
                      <ul className="space-y-4">
                        {topic.replies.map((r, replyIndex) => (
                          <ReplyItem
                            key={r.id}
                            reply={r}
                            canEdit={r.authorId === viewerId}
                            // The first reply is the topic's opening message; it goes with "Delete topic".
                            canDelete={replyIndex > 0 && (r.authorId === viewerId || canModerate)}
                            onDelete={(id) => setConfirm({ kind: "reply", id })}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-ink-muted">{t("batches.discussions.noReplies")}</p>
                    )}
                    <ReplyForm topicId={topic.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={doDelete}
        loading={pending}
        destructive
        title={confirm?.kind === "topic" ? t("batches.discussions.deleteTopicTitle") : t("batches.discussions.deleteReplyTitle")}
        description={confirm?.kind === "topic" ? t("batches.discussions.deleteTopicDescription") : t("batches.discussions.deleteReplyDescription")}
        confirmLabel={common("actions.delete")}
      />
    </div>
  );
}

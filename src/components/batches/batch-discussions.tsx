"use client";

import { useState, useSyncExternalStore } from "react";
import { Markdown } from "@/lib/markdown";
import { cn, formatDateTime, pluralize, relativeTime } from "@/lib/utils";
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

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function useHash(): string {
  return useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
}

function NewTopicForm({ batchId, onDone }: { batchId: string; onDone: () => void }) {
  const { onSubmit, pending, error, fieldErrors } = useActionForm(createBatchTopicAction, { onSuccess: onDone });
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <input type="hidden" name="batchId" value={batchId} />
      <FormError message={error} />
      <Field label="Title" htmlFor="topic-title" required error={fieldErrors.title}>
        <Input id="topic-title" name="title" required maxLength={200} placeholder="What would you like to discuss?" invalid={!!fieldErrors.title} autoFocus />
      </Field>
      <Field label="Message" htmlFor="topic-content" required error={fieldErrors.content} hint="Markdown is supported. Mention someone with @username.">
        <Textarea id="topic-content" name="content" rows={5} required invalid={!!fieldErrors.content} placeholder="Add details, code snippets or links…" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} leftIcon={<Icon.Send className="size-4" />}>
          Post topic
        </Button>
      </div>
    </form>
  );
}

function ReplyForm({ topicId }: { topicId: string }) {
  const [formKey, setFormKey] = useState(0);
  const { onSubmit, pending, error, fieldErrors } = useActionForm(replyBatchTopicAction, { onSuccess: () => setFormKey((k) => k + 1), toast: false });
  return (
    <form key={formKey} onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="topicId" value={topicId} />
      <FormError message={error && !fieldErrors.content ? error : null} />
      <label htmlFor={`reply-${topicId}`} className="sr-only">
        Your reply
      </label>
      <Textarea id={`reply-${topicId}`} name="content" rows={3} placeholder="Write a reply… (markdown supported)" invalid={!!fieldErrors.content} required />
      {fieldErrors.content && <p className="text-xs text-danger">{fieldErrors.content}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={pending} leftIcon={<Icon.Send className="size-4" />}>
          Reply
        </Button>
      </div>
    </form>
  );
}

function ReplyItem({ reply, canEdit, canDelete, onDelete }: { reply: ReplyView; canEdit: boolean; canDelete: boolean; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const { onSubmit, pending, error } = useActionForm(updateBatchReplyAction, { onSuccess: () => setEditing(false) });
  const edited = reply.updatedAt > reply.createdAt;
  return (
    <li className="flex gap-3">
      <Avatar name={reply.author?.name ?? "Member"} src={reply.author?.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium text-ink">{reply.author?.name ?? "Former member"}</span>
          <time dateTime={reply.createdAt} title={formatDateTime(reply.createdAt)} className="text-xs text-ink-muted" suppressHydrationWarning>
            {relativeTime(reply.createdAt)}
          </time>
          {edited && <span className="text-xs text-ink-faint">(edited)</span>}
          {!editing && (canEdit || canDelete) && (
            <span className="ml-auto flex gap-0.5">
              {canEdit && (
                <IconButton label="Edit reply" size="icon-sm" onClick={() => setEditing(true)}>
                  <Icon.Edit className="size-3.5" />
                </IconButton>
              )}
              {canDelete && (
                <IconButton label="Delete reply" size="icon-sm" onClick={() => onDelete(reply.id)} className="hover:text-danger">
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
              Edit reply
            </label>
            <Textarea id={`edit-${reply.id}`} name="content" rows={4} defaultValue={reply.content} required autoFocus />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" type="submit" loading={pending}>
                Save
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Discussions</h2>
          <p className="text-sm text-ink-muted">Ask questions, share resources and help each other out.</p>
        </div>
        {!composing && (
          <Button onClick={() => setComposing(true)} leftIcon={<Icon.Plus className="size-4" />}>
            New topic
          </Button>
        )}
      </div>

      {composing && <NewTopicForm batchId={batchId} onDone={() => setComposing(false)} />}

      {threads.length === 0 && !composing ? (
        <EmptyState
          icon={<Icon.MessageCircle />}
          title="No discussions yet"
          description="Start the first topic to ask a question or share something with your cohort."
          action={
            <Button onClick={() => setComposing(true)} leftIcon={<Icon.Plus className="size-4" />}>
              Start a discussion
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {threads.map((t, index) => {
            const open = isOpen(t.id, index);
            const canDeleteTopic = t.authorId === viewerId || canModerate;
            return (
              <li key={t.id} id={`topic-${t.id}`} className="scroll-mt-24 overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
                <div className="flex items-start gap-3 p-4">
                  <Avatar name={t.author?.name ?? "Member"} src={t.author?.avatarUrl} size="sm" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={open}
                    aria-controls={`topic-body-${t.id}`}
                    onClick={() => setToggled((s) => ({ ...s, [t.id]: !open }))}
                  >
                    <span className="block font-semibold text-ink hover:text-accent">{t.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted" suppressHydrationWarning>
                      {t.author?.name ?? "Former member"} · {relativeTime(t.createdAt)} · {pluralize(Math.max(0, t.replies.length - 1), "reply", "replies")}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {canDeleteTopic && (
                      <IconButton label="Delete topic" size="icon-sm" onClick={() => setConfirm({ kind: "topic", id: t.id })} className="hover:text-danger">
                        <Icon.Trash className="size-4" />
                      </IconButton>
                    )}
                    <IconButton label={open ? "Collapse" : "Expand"} size="icon-sm" onClick={() => setToggled((s) => ({ ...s, [t.id]: !open }))}>
                      <Icon.ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                    </IconButton>
                  </div>
                </div>
                {open && (
                  <div id={`topic-body-${t.id}`} className="space-y-4 border-t border-border bg-surface-2/40 p-4">
                    {t.replies.length > 0 ? (
                      <ul className="space-y-4">
                        {t.replies.map((r, replyIndex) => (
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
                      <p className="text-sm text-ink-muted">No replies yet. Be the first to respond.</p>
                    )}
                    <ReplyForm topicId={t.id} />
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
        title={confirm?.kind === "topic" ? "Delete this discussion?" : "Delete this reply?"}
        description={
          confirm?.kind === "topic" ? "The topic and all of its replies will be removed for everyone. This cannot be undone." : "This reply will be removed for everyone. This cannot be undone."
        }
        confirmLabel="Delete"
      />
    </div>
  );
}

"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { createReplyAction, createTopicAction, deleteReplyAction, deleteTopicAction, updateReplyAction, updateTopicAction } from "@/lib/actions/discussions";
import { Markdown } from "@/lib/markdown";
import { cn, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { MessageQuestionIcon } from "./learn-icons";
import { MentionTextarea } from "./mention-textarea";
import type { MentionOption, ReplyItem, TopicItem } from "./types";

export interface DiscussionPanelProps {
  lessonId: string;
  topics: TopicItem[];
  /** Enrolled learners and course managers may post. */
  canPost: boolean;
  /** Course managers may delete any reply or question. */
  canModerate: boolean;
  /** When set, discussions are closed on this lesson and this text explains why. */
  closedReason?: string | null;
  /** People the viewer may @mention (all enabled users for staff and instructors; course members for learners). */
  mentionables: MentionOption[];
  initialTopicId?: string | null;
}

/** Discussion tab: questions about this lesson, threads, replies and @mentions. */
export function DiscussionPanel({ lessonId, topics, canPost, canModerate, closedReason, mentionables, initialTopicId }: DiscussionPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(() => (initialTopicId && topics.some((t) => t.id === initialTopicId) ? initialTopicId : null));
  const [awaitingId, setAwaitingId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const selected = selectedId ? (topics.find((t) => t.id === selectedId) ?? null) : null;

  if (closedReason) {
    return (
      <div className="p-4">
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border-strong bg-surface-2/60 p-4">
          <Icon.Lock className="mt-0.5 size-5 shrink-0 text-ink-faint" />
          <div>
            <p className="text-sm font-medium text-ink">Discussions are closed on this lesson</p>
            <p className="mt-0.5 text-sm text-ink-muted">{closedReason}</p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedId && !selected) {
    // A just-created question that is still on its way from the server, or one that was deleted.
    if (awaitingId === selectedId) {
      return (
        <div className="space-y-3 p-4" aria-busy="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      );
    }
  }

  if (selected) {
    return (
      <TopicThread
        topic={selected}
        canPost={canPost}
        canModerate={canModerate}
        mentionables={mentionables}
        onBack={() => setSelectedId(null)}
        onDeleted={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Questions</h2>
          <p className="text-xs text-ink-muted">Ask about this lesson. Instructors are notified.</p>
        </div>
        {canPost && (
          <Button size="sm" leftIcon={<Icon.Plus className="size-4" />} onClick={() => setNewOpen(true)}>
            New question
          </Button>
        )}
      </div>

      {topics.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-center">
          <Icon.MessageSquare className="size-7 text-ink-faint" />
          <p className="text-sm text-ink-muted">Ask a question to get help from the community.</p>
          {canPost && (
            <Button variant="outline" size="sm" onClick={() => setNewOpen(true)} className="mt-1">
              Ask a question
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface-1">
          {topics.map((topic) => {
            const replyCount = Math.max(0, topic.replies.length - 1);
            const instructorReplied = topic.replies.slice(1).some((r) => r.isInstructor);
            return (
              <li key={topic.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(topic.id)}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
                >
                  <Avatar name={topic.author?.name ?? "Deleted user"} src={topic.author?.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium text-ink">{topic.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {topic.author?.name ?? "Deleted user"} · <span suppressHydrationWarning>{relativeTime(topic.updatedAt)}</span>
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span className="inline-flex items-center gap-1">
                        <Icon.MessageSquare className="size-3.5" />
                        {replyCount} {replyCount === 1 ? "reply" : "replies"}
                      </span>
                      {instructorReplied && (
                        <Badge tone="success" size="xs">
                          Instructor replied
                        </Badge>
                      )}
                    </span>
                  </span>
                  <Icon.ChevronRight className="mt-1 size-4 shrink-0 text-ink-faint" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!canPost && <p className="mt-3 text-xs text-ink-muted">Enroll in this course to ask questions and reply.</p>}

      <NewTopicDialog
        open={newOpen}
        lessonId={lessonId}
        mentionables={mentionables}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          setNewOpen(false);
          setAwaitingId(id);
          setSelectedId(id);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New question                                                         */
/* ------------------------------------------------------------------ */

function NewTopicDialog({
  open,
  lessonId,
  mentionables,
  onClose,
  onCreated,
}: {
  open: boolean;
  lessonId: string;
  mentionables: MentionOption[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [formKey, setFormKey] = useState(0);
  const [details, setDetails] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult<{ topicId: string }> | null, FormData>(async (prev, formData) => {
    const res = await createTopicAction(prev, formData);
    if (res.ok) {
      toast.success("Question posted", "The instructors have been notified.");
      setFormKey((k) => k + 1);
      setDetails("");
      onCreated(res.data.topicId);
    }
    return res;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <Dialog open={open} onClose={onClose} title="New question" description="Describe what you are stuck on. Markdown is supported." size="lg">
      <form key={formKey} action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="lessonId" value={lessonId} />
        <FormError message={state && !state.ok && !state.fieldErrors ? state.error : null} />
        <Field label="Title" htmlFor="topic-title" error={errors.title} required>
          <Input id="topic-title" name="title" maxLength={160} placeholder="e.g. Why does map return undefined here?" invalid={!!errors.title} autoComplete="off" />
        </Field>
        <Field label="Details" htmlFor="topic-content" error={errors.content} hint="Include what you tried and any error messages. Type @ to mention someone." required>
          <MentionTextarea
            id="topic-content"
            name="content"
            rows={6}
            maxLength={10000}
            placeholder="Explain your question…"
            invalid={!!errors.content}
            value={details}
            onValueChange={setDetails}
            mentionables={mentionables}
            placement="below"
          />
        </Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Post
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Thread                                                               */
/* ------------------------------------------------------------------ */

function TopicThread({
  topic,
  canPost,
  canModerate,
  mentionables,
  onBack,
  onDeleted,
}: {
  topic: TopicItem;
  canPost: boolean;
  canModerate: boolean;
  mentionables: MentionOption[];
  onBack: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const canDeleteTopic = topic.isOwn || canModerate;

  const topicMenu: DropdownItem[] = [];
  if (topic.isOwn) topicMenu.push({ label: "Edit title", icon: <Icon.Edit />, onClick: () => setRenaming(true) });
  if (canDeleteTopic) topicMenu.push({ label: "Delete question", icon: <Icon.Trash />, destructive: true, onClick: () => setConfirmDelete(true) });

  const removeTopic = () => {
    startDelete(async () => {
      const res = await deleteTopicAction(topic.id);
      if (!res.ok) {
        toast.error("Could not delete the question", res.error);
        return;
      }
      setConfirmDelete(false);
      toast.success("Question deleted");
      onDeleted();
    });
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface-1/95 px-3 py-2 backdrop-blur">
        <Button variant="ghost" size="xs" leftIcon={<Icon.ChevronLeft className="size-4" />} onClick={onBack}>
          All questions
        </Button>
        {topicMenu.length > 0 && (
          <Dropdown
            trigger={
              <span className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink">
                <Icon.MoreHorizontal className="size-4" />
                <span className="sr-only">Question actions</span>
              </span>
            }
            items={topicMenu}
          />
        )}
      </div>

      <div className="px-4 pt-4">
        {renaming ? (
          <RenameTopicForm topic={topic} onDone={() => setRenaming(false)} />
        ) : (
          <h3 className="text-base font-semibold leading-snug text-ink">{topic.title}</h3>
        )}
        <p className="mt-1 text-xs text-ink-muted">
          Asked by {topic.author?.name ?? "Deleted user"} · <span suppressHydrationWarning>{relativeTime(topic.createdAt)}</span>
        </p>
      </div>

      <ol className="mt-4 flex-1 space-y-4 px-4">
        {topic.replies.map((reply, i) => (
          <li key={reply.id}>
            <ReplyRow reply={reply} isQuestion={i === 0} canModerate={canModerate} onTopicDeleted={onDeleted} />
          </li>
        ))}
      </ol>

      {canPost ? (
        <ReplyComposer topicId={topic.id} mentionables={mentionables} />
      ) : (
        <p className="m-4 rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">Enroll in this course to reply.</p>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={removeTopic}
        title="Delete this question?"
        description="The question and all of its replies will be removed. This cannot be undone."
        confirmLabel="Delete question"
        destructive
        loading={deleting}
      />
    </div>
  );
}

function RenameTopicForm({ topic, onDone }: { topic: TopicItem; onDone: () => void }) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const res = await updateTopicAction(prev, formData);
    if (res.ok) {
      toast.success("Question updated");
      onDone();
    }
    return res;
  }, null);
  const error = state && !state.ok ? (state.fieldErrors?.title ?? state.error) : null;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="topicId" value={topic.id} />
      <label htmlFor={`rename-${topic.id}`} className="sr-only">
        Question title
      </label>
      <Input id={`rename-${topic.id}`} name="title" defaultValue={topic.title} maxLength={160} invalid={!!error} autoFocus />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="xs" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="xs" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

function ReplyRow({ reply, isQuestion, canModerate, onTopicDeleted }: { reply: ReplyItem; isQuestion: boolean; canModerate: boolean; onTopicDeleted: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, startDelete] = useTransition();
  const canDelete = reply.isOwn || canModerate;

  const items: DropdownItem[] = [];
  if (reply.isOwn) items.push({ label: "Edit", icon: <Icon.Edit />, onClick: () => setEditing(true) });
  if (canDelete) items.push({ label: "Delete", icon: <Icon.Trash />, destructive: true, onClick: () => setConfirmOpen(true) });

  const remove = () => {
    startDelete(async () => {
      const res = await deleteReplyAction(reply.id);
      if (!res.ok) {
        toast.error("Could not delete", res.error);
        return;
      }
      setConfirmOpen(false);
      toast.success(res.message ?? "Reply deleted");
      if (res.data.topicDeleted) onTopicDeleted();
    });
  };

  return (
    <article className={cn("rounded-xl border p-3", reply.isInstructor ? "border-accent/30 bg-accent/5" : "border-border bg-surface-1")}>
      <header className="flex items-center gap-2">
        <Avatar name={reply.author?.name ?? "Deleted user"} src={reply.author?.avatarUrl} size="xs" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium text-ink">{reply.author?.name ?? "Deleted user"}</span>
          {reply.isInstructor && (
            <Badge tone="accent" size="xs">
              Instructor
            </Badge>
          )}
          {isQuestion && (
            <Badge tone="neutral" size="xs">
              Question
            </Badge>
          )}
          <span className="text-xs text-ink-faint">
            <time dateTime={reply.createdAt} suppressHydrationWarning>
              {relativeTime(reply.createdAt)}
            </time>
            {reply.edited && " · edited"}
          </span>
        </div>
        {items.length > 0 && (
          <Dropdown
            trigger={
              <span className="flex size-6 items-center justify-center rounded-md text-ink-faint hover:bg-surface-2 hover:text-ink">
                <Icon.MoreHorizontal className="size-4" />
                <span className="sr-only">Reply actions</span>
              </span>
            }
            items={items}
          />
        )}
      </header>
      {editing ? (
        <EditReplyForm reply={reply} onDone={() => setEditing(false)} />
      ) : (
        <div className="mt-2 break-words">
          <Markdown content={reply.content} />
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
        title={isQuestion ? "Delete this question?" : "Delete this reply?"}
        description={isQuestion ? "This is the opening post, so the whole question and its replies will be removed." : "The reply will be removed permanently."}
        confirmLabel="Delete"
        destructive
        loading={deleting}
      />
    </article>
  );
}

function EditReplyForm({ reply, onDone }: { reply: ReplyItem; onDone: () => void }) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const res = await updateReplyAction(prev, formData);
    if (res.ok) {
      toast.success("Reply updated");
      onDone();
    }
    return res;
  }, null);
  const error = state && !state.ok ? (state.fieldErrors?.content ?? state.error) : null;
  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="replyId" value={reply.id} />
      <label htmlFor={`edit-reply-${reply.id}`} className="sr-only">
        Edit reply
      </label>
      <Textarea id={`edit-reply-${reply.id}`} name="content" rows={4} defaultValue={reply.content} maxLength={10000} invalid={!!error} autoFocus />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="xs" onClick={onDone} disabled={pending}>
          Discard
        </Button>
        <Button type="submit" size="xs" loading={pending}>
          Post
        </Button>
      </div>
    </form>
  );
}

function ReplyComposer({ topicId, mentionables }: { topicId: string; mentionables: MentionOption[] }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [text, setText] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult<{ replyId: string }> | null, FormData>(async (prev, formData) => {
    const res = await createReplyAction(prev, formData);
    if (res.ok) {
      setText("");
      toast.success("Reply posted");
    }
    return res;
  }, null);
  const error = state && !state.ok ? (state.fieldErrors?.content ?? state.error) : null;
  const quickPicks = mentionables.filter((m) => m.isInstructor);

  const insertMention = (username: string) => {
    const area = formRef.current?.querySelector<HTMLTextAreaElement>("textarea");
    const mention = `@${username} `;
    if (!area) {
      setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}${mention}`);
      return;
    }
    const start = area.selectionStart ?? text.length;
    const end = area.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${prefix}${mention}${text.slice(end)}`;
    setText(next);
    const caret = before.length + prefix.length + mention.length;
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(caret, caret);
    });
  };

  return (
    <form ref={formRef} action={formAction} className="sticky bottom-0 mt-4 space-y-2 border-t border-border bg-surface-1 p-3">
      <input type="hidden" name="topicId" value={topicId} />
      <label htmlFor={`reply-${topicId}`} className="sr-only">
        Your reply
      </label>
      <MentionTextarea
        id={`reply-${topicId}`}
        name="content"
        rows={3}
        value={text}
        onValueChange={setText}
        mentionables={mentionables}
        placeholder="Type your reply here..."
        maxLength={10000}
        invalid={!!error}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {mentionables.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-ink-muted">
            <MessageQuestionIcon className="size-3.5" />
            <span>{quickPicks.length > 0 ? "Type @ to mention, or:" : "Type @ to mention someone"}</span>
            {quickPicks.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => insertMention(m.username)}
                className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-ink-muted transition-colors hover:bg-accent/10 hover:text-accent"
                title={`Mention ${m.name}`}
              >
                @{m.username}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" loading={pending} disabled={!text.trim()} rightIcon={<Icon.Send className="size-3.5" />}>
          Post
        </Button>
      </div>
    </form>
  );
}

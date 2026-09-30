"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ChatMessageView, ConversationSummary, QuotaView } from "@/lib/ai/types";
import { clearCourseConversationsAction, deleteConversationAction, loadConversationAction } from "@/lib/actions/ai";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn, pluralize, relativeTime } from "@/lib/utils";
import { AiChatView } from "./ai-chat";
import { useAiChat } from "./use-ai-chat";

export interface AskAiLesson {
  id: string;
  title: string;
  href: string;
}

export interface AskAiWorkspaceProps {
  courseId: string;
  courseTitle: string;
  courseHref: string;
  /** Lesson the learner came from (`?lesson=`): new conversations are about it. */
  lesson: AskAiLesson | null;
  starterQuestions: string[];
  conversations: ConversationSummary[];
  initialConversation: ConversationSummary | null;
  initialMessages: ChatMessageView[];
  initialQuota: QuotaView | null;
}

const PAGE_SIZE = 30;
/** The search box appears once the list is long enough to need it. */
const SEARCH_FROM = 6;

type PendingDelete = { kind: "one"; conversation: ConversationSummary } | { kind: "all" };

/** Keep the address bar on the open conversation without a navigation (reloading reopens it). */
function replaceQuery(query: string) {
  window.history.replaceState(null, "", `${window.location.pathname}${query}`);
}

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  loadingId: string | null;
  onOpen: (id: string) => void;
  onDelete: (conversation: ConversationSummary) => void;
  onClearAll: () => void;
  onNew: () => void;
  /** Prefix for element ids, so the desktop column and the phone dialog don't clash. */
  idPrefix: string;
}

function ConversationList({ conversations, activeId, loadingId, onOpen, onDelete, onClearAll, onNew, idPrefix }: ConversationListProps) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? conversations.filter((c) => c.title.toLowerCase().includes(needle) || (c.lessonTitle ?? "").toLowerCase().includes(needle)) : conversations),
    [conversations, needle],
  );
  const visible = matches.slice(0, shown);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 p-3">
        <Button variant="outline" size="sm" className="w-full" onClick={onNew} leftIcon={<Icon.Plus className="size-4" />}>
          New conversation
        </Button>
        {conversations.length >= SEARCH_FROM && (
          <Input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE_SIZE);
            }}
            placeholder="Search conversations"
            aria-label="Search conversations"
            leftAddon={<Icon.Search className="size-4" />}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 scrollbar-thin">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-muted">Your conversations with the tutor will appear here.</p>
        ) : matches.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-muted">No conversations match “{query.trim()}”.</p>
        ) : (
          <ul className="space-y-0.5" aria-label="Conversations">
            {visible.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id} className={cn("group relative rounded-lg", active ? "bg-accent/10" : "hover:bg-surface-2")}>
                  <button
                    type="button"
                    id={`${idPrefix}-${c.id}`}
                    onClick={() => onOpen(c.id)}
                    aria-current={active ? "true" : undefined}
                    className="block w-full rounded-lg py-2 pl-3 pr-10 text-left focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className={cn("block truncate text-sm", active ? "font-medium text-ink" : "text-ink")}>{c.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-faint">
                      {loadingId === c.id ? (
                        <>
                          <Icon.Loader className="size-3 animate-spin" /> Opening…
                        </>
                      ) : (
                        <>
                          {c.lessonTitle && <span className="min-w-0 truncate">{c.lessonTitle}</span>}
                          {c.lessonTitle && <span aria-hidden="true">·</span>}
                          <time dateTime={c.updatedAt} className="shrink-0" suppressHydrationWarning>
                            {relativeTime(c.updatedAt)}
                          </time>
                        </>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c)}
                    aria-label={`Delete conversation “${c.title}”`}
                    title="Delete conversation"
                    className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint hover:bg-surface-3 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100"
                  >
                    <Icon.Trash className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {matches.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} className="mt-1 w-full rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2">
            Show {Math.min(PAGE_SIZE, matches.length - shown)} more
          </button>
        )}
      </div>

      {conversations.length > 0 && (
        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon.Trash className="size-3.5" /> Delete all conversations
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Full-page AI tutor (`/courses/[slug]/ask`): the learner's conversations for
 * the course next to the chat. Below 1024px the list moves into a dialog
 * opened with the "History" button.
 */
export function AskAiWorkspace({ courseId, courseTitle, courseHref, lesson, starterQuestions, conversations: initialConversations, initialConversation, initialMessages, initialQuota }: AskAiWorkspaceProps) {
  const toast = useToast();
  const [conversations, setConversations] = useState(initialConversations);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, startDelete] = useTransition();
  const [, startOpen] = useTransition();

  // The conversation the address bar points to: set by the server for a real navigation, by `pointUrlAt` for switches made here.
  const linkedId = initialConversation?.id ?? null;
  const urlIdRef = useRef(linkedId);
  const lessonId = lesson?.id ?? null;
  const pointUrlAt = useCallback(
    (id: string | null) => {
      urlIdRef.current = id;
      replaceQuery(id ? `?c=${id}` : lessonId ? `?lesson=${lessonId}` : "");
    },
    [lessonId],
  );

  const onConversation = useCallback(
    (summary: ConversationSummary) => {
      setConversations((list) => [summary, ...list.filter((c) => c.id !== summary.id)]);
      pointUrlAt(summary.id);
    },
    [pointUrlAt],
  );

  // A new conversation is about the lesson from the URL; an existing one keeps the lesson it was started from.
  const chat = useAiChat({ courseId, lessonId, initialConversation, initialMessages, initialQuota, onConversation });
  const activeId = chat.conversation?.id ?? null;
  const { load } = chat;

  // Runs whenever the server sends this page again. After a refresh the server agrees with the address bar and
  // nothing happens; after following a link to another conversation (e.g. from a notification) that one opens.
  useEffect(() => {
    if (urlIdRef.current === linkedId) return;
    urlIdRef.current = linkedId;
    if (initialConversation) load({ conversation: initialConversation, messages: initialMessages });
  }, [linkedId, initialConversation, initialMessages, load]);

  const startNew = () => {
    chat.load({ conversation: null, messages: [] });
    setHistoryOpen(false);
    pointUrlAt(null);
  };

  const open = (id: string) => {
    if (id === activeId) {
      setHistoryOpen(false);
      return;
    }
    setLoadingId(id);
    startOpen(async () => {
      const result = await loadConversationAction(id).catch(() => null);
      setLoadingId(null);
      if (!result?.ok) {
        toast.error(result?.error ?? "The conversation couldn't be opened. Check your connection and try again.");
        return;
      }
      chat.load(result.data);
      setHistoryOpen(false);
      pointUrlAt(id);
    });
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    if (!target) return;
    startDelete(async () => {
      if (target.kind === "one") {
        const result = await deleteConversationAction(target.conversation.id).catch(() => null);
        if (!result?.ok) {
          toast.error(result?.error ?? "The conversation couldn't be deleted. Try again.");
        } else {
          setConversations((list) => list.filter((c) => c.id !== target.conversation.id));
          if (target.conversation.id === activeId) startNew();
          toast.success(result.message ?? "Conversation deleted");
        }
      } else {
        const result = await clearCourseConversationsAction(courseId).catch(() => null);
        if (!result?.ok) {
          toast.error(result?.error ?? "The conversations couldn't be deleted. Try again.");
        } else {
          setConversations([]);
          startNew();
          toast.success(result.message ?? "Conversations deleted");
        }
      }
      setPendingDelete(null);
    });
  };

  const listProps = {
    conversations,
    activeId,
    loadingId,
    onOpen: open,
    onDelete: (conversation: ConversationSummary) => setPendingDelete({ kind: "one", conversation }),
    onClearAll: () => setPendingDelete({ kind: "all" }),
    onNew: startNew,
  };

  // What the chat is about: the opened conversation's lesson, or the lesson a new conversation starts from.
  const about = chat.conversation ? (chat.conversation.lessonTitle && chat.conversation.lessonHref ? { title: chat.conversation.lessonTitle, href: chat.conversation.lessonHref } : null) : lesson;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href={courseHref} className="inline-flex max-w-full items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <Icon.ArrowLeft className="size-4 shrink-0" /> <span className="truncate">{courseTitle}</span>
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            <Icon.Sparkles className="size-5 text-accent" /> Ask AI
          </h1>
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} leftIcon={<Icon.Clock className="size-4" />}>
            History{conversations.length > 0 ? ` (${conversations.length})` : ""}
          </Button>
          <Button variant="outline" size="sm" onClick={startNew} disabled={!chat.conversation && chat.messages.length === 0} leftIcon={<Icon.Plus className="size-4" />}>
            New
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside aria-label="Your conversations" className="hidden h-[calc(100dvh-11.5rem)] min-h-112 overflow-hidden rounded-card border border-border bg-surface-1 lg:block">
          <ConversationList {...listProps} idPrefix="ask-list" />
        </aside>

        <section aria-label="Conversation with the AI tutor" className="flex h-[calc(100dvh-16.5rem)] min-h-104 flex-col overflow-hidden rounded-card border border-border bg-surface-1 lg:h-[calc(100dvh-11.5rem)] lg:min-h-112">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 sm:px-6">
            <h2 className="min-w-0 truncate text-sm font-semibold text-ink">{chat.conversation?.title ?? "New conversation"}</h2>
            <div className="flex min-w-0 items-center gap-3 text-xs text-ink-muted">
              {about && (
                <Link href={about.href} className="inline-flex min-w-0 items-center gap-1 hover:text-ink" title={`Open the lesson “${about.title}”`}>
                  <Icon.BookOpen className="size-3.5 shrink-0" />
                  <span className="truncate">{about.title}</span>
                </Link>
              )}
              {chat.conversation && (
                <button
                  type="button"
                  onClick={() => setPendingDelete({ kind: "one", conversation: chat.conversation! })}
                  className="inline-flex shrink-0 items-center gap-1 rounded hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Icon.Trash className="size-3.5" /> Clear
                </button>
              )}
            </div>
          </div>
          <AiChatView chat={chat} starterQuestions={starterQuestions} courseTitle={courseTitle} className="min-h-0 flex-1" />
        </section>
      </div>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} title="Your conversations" description={`${pluralize(conversations.length, "conversation")} in this course`}>
        {/* The list brings its own padding and scrolling, so it fills the dialog body edge to edge. */}
        <div className="-mx-5 -my-4 h-[60vh]">
          <ConversationList {...listProps} idPrefix="ask-sheet" />
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={pendingDelete?.kind === "all" ? "Delete all conversations?" : "Delete this conversation?"}
        description={
          pendingDelete?.kind === "all"
            ? `Every conversation you had with the AI tutor in ${courseTitle} will be deleted for good.`
            : "The questions and answers in this conversation will be deleted for good."
        }
        confirmLabel={pendingDelete?.kind === "all" ? "Delete all" : "Delete"}
        destructive
        loading={deleting}
      />
    </div>
  );
}

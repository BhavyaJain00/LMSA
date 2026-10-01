"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { cn, formatDateTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { Field, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useViewerTimeZone } from "@/components/batches/hooks";
import { loadOlderMessagesAction, removeMessageAction, reportConversationAction, resolveReportAction, sendMessageAction } from "@/lib/actions/messages";
import { MESSAGE_LIMITS } from "@/lib/comms/messages-core";
import type { MessageView, ParticipantView, ThreadUpdate, ThreadView as Thread } from "@/lib/comms/messages";
import { announceInboxChange } from "./conversation-list";
import { MessageBody } from "./message-body";
import { MessageComposer } from "./message-composer";

/** A message the viewer is sending (or failed to send). */
interface Pending {
  id: string;
  body: string;
  createdAt: string;
  failed?: string;
}

/** Messages from one sender within this gap are drawn as one group. */
const GROUP_GAP_MS = 5 * 60_000;

function dayLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  const key = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (key(d) === key(today)) return "Today";
  if (key(d) === key(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(d);
}

function clock(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function mergeMessages(current: MessageView[], incoming: MessageView[]): MessageView[] {
  if (!incoming.length) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function ThreadHeader({
  thread,
  others,
  onReport,
  onResolve,
  resolving,
}: {
  thread: Thread;
  others: ParticipantView[];
  onReport: () => void;
  onResolve: () => void;
  resolving: boolean;
}) {
  const first = others[0];
  const items: DropdownItem[] = [];
  for (const o of others) if (o.username) items.push({ label: `View ${o.name.split(" ")[0]}'s profile`, icon: <Icon.User className="size-4" />, href: `/user/${o.username}` });
  if (thread.course) items.push({ label: "Open the course", icon: <Icon.BookOpen className="size-4" />, href: `/courses/${thread.course.slug}` });
  if (thread.access === "participant" && !thread.reportedByViewer) items.push({ label: "Report conversation", icon: <Icon.AlertTriangle className="size-4" />, onClick: onReport, destructive: true, separator: items.length > 0 });
  if (thread.access === "moderator" && thread.report?.status === "open") items.push({ label: "Resolve report", icon: <Icon.CheckCircle className="size-4" />, onClick: onResolve, separator: true, disabled: resolving });
  const title = thread.access === "moderator" ? thread.participants.map((p) => p.name).join(" · ") : others.map((o) => o.name).join(", ") || "Just you";
  return (
    <header className="flex items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
      <Link href="/messages" className="-ml-1 rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink lg:hidden" aria-label="Back to conversations">
        <Icon.ArrowLeft className="size-5" />
      </Link>
      {first && <Avatar name={first.name} src={first.avatarUrl} size="sm" className={cn(!first.active && "opacity-50")} />}
      <div className="min-w-0 flex-1">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <span className="truncate">{title}</span>
          {thread.access === "participant" && first?.role && (
            <Badge tone="accent" size="xs">
              {first.role}
            </Badge>
          )}
          {first && !first.active && (
            <Badge tone="neutral" size="xs">
              Inactive
            </Badge>
          )}
        </h2>
        <p className="truncate text-xs text-ink-muted">
          {thread.subject ?? (thread.course ? `About ${thread.course.title}` : (first?.headline ?? (thread.access === "moderator" ? "Reported conversation" : "Direct message")))}
        </p>
      </div>
      {items.length > 0 && (
        <Dropdown
          trigger={
            <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
              <Icon.MoreVertical className="size-4" aria-hidden="true" />
              <span className="sr-only">Conversation options</span>
            </span>
          }
          items={items}
        />
      )}
    </header>
  );
}

/**
 * An open conversation: messages grouped by day and sender, read receipts,
 * polling every 10 seconds (new messages, removals, "Seen"), older pages,
 * optimistic sending with retry, removing own messages, reporting, and the
 * moderator view of reported conversations.
 */
export function ThreadView({ initial, viewerId }: { initial: Thread; viewerId: string }) {
  const router = useRouter();
  const toast = useToast();
  const tz = useViewerTimeZone() ?? "UTC";
  const [messages, setMessages] = useState(initial.messages);
  const [hasOlder, setHasOlder] = useState(initial.hasOlder);
  const [seenId, setSeenId] = useState(initial.seenMessageId);
  const [replyBlocked, setReplyBlocked] = useState(initial.replyBlocked);
  const [pending, setPending] = useState<Pending[]>([]);
  const [newBelow, setNewBelow] = useState(false);
  const [reportOpen, setReportOpen] = useState<{ messageId?: string } | null>(null);
  const [reason, setReason] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [loadingOlder, startOlder] = useTransition();
  const [reporting, startReport] = useTransition();
  const [removing, startRemove] = useTransition();
  const [resolving, startResolve] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const restore = useRef<number | null>(null);
  const latest = useRef(messages);
  useEffect(() => {
    latest.current = messages;
  }, [messages]);

  const participants = useMemo(() => new Map(initial.participants.map((p) => [p.id, p])), [initial.participants]);
  const others = initial.participants.filter((p) => p.id !== viewerId);
  const moderator = initial.access === "moderator";

  const scrollToBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewBelow(false);
  };

  // Keep the view pinned to the newest message unless the reader scrolled up; keep the position when older messages load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const poll = useCallback(async () => {
    const shown = latest.current;
    const params = new URLSearchParams({ c: initial.id });
    const last = shown[shown.length - 1];
    if (last) params.set("after", last.id);
    params.set("known", shown.slice(-200).map((m) => m.id).join(","));
    if (!moderator && document.visibilityState === "visible") params.set("read", "1");
    try {
      const res = await fetch(`/messages/feed?${params.toString()}`, { cache: "no-store" });
      if (res.status === 404) {
        router.replace("/messages");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: ThreadUpdate };
      const update = data.thread;
      if (!update) return;
      const removed = new Set(update.removedIds);
      setMessages((prev) => mergeMessages(prev.map((m) => (removed.has(m.id) && !m.removed ? { ...m, body: "", removed: true } : m)), update.messages));
      setSeenId(update.seenMessageId);
      setReplyBlocked(update.replyBlocked);
      if (update.messages.some((m) => m.senderId !== viewerId)) {
        if (!stick.current) setNewBelow(true);
        announceInboxChange();
      }
    } catch {
      // Offline: try again on the next tick.
    }
  }, [initial.id, moderator, router, viewerId]);

  useEffect(() => {
    // First poll right after mounting: it marks the conversation read and refreshes the inbox counts.
    const firstPoll = window.setTimeout(() => void poll().then(announceInboxChange), 0);
    const tick = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const id = window.setInterval(tick, MESSAGE_LIMITS.pollMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearTimeout(firstPoll);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [poll]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current) setNewBelow(false);
  };

  const loadOlder = () => {
    const first = messages[0];
    if (!first) return;
    startOlder(async () => {
      const result = await loadOlderMessagesAction(initial.id, first.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const el = scroller.current;
      if (el) restore.current = el.scrollHeight - el.scrollTop;
      setMessages((prev) => mergeMessages(prev, result.data.messages));
      setHasOlder(result.data.hasOlder);
    });
  };

  const deliver = async (p: Pending): Promise<boolean> => {
    const result = await sendMessageAction(initial.id, p.body);
    if (result.ok) {
      setPending((list) => list.filter((x) => x.id !== p.id));
      setMessages((prev) => mergeMessages(prev, [result.data.message]));
      announceInboxChange();
      return true;
    }
    setPending((list) => list.map((x) => (x.id === p.id ? { ...x, failed: result.error } : x)));
    return false;
  };

  const send = async (body: string): Promise<boolean> => {
    const p: Pending = { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, body: body.trim(), createdAt: new Date().toISOString() };
    stick.current = true;
    setPending((list) => [...list, p]);
    void deliver(p);
    // The box is cleared at once; a failed message stays in the thread with "Retry".
    return true;
  };

  const retry = (p: Pending) => {
    setPending((list) => list.map((x) => (x.id === p.id ? { ...x, failed: undefined } : x)));
    void deliver(p);
  };

  const submitReport = () => {
    setReportError(null);
    startReport(async () => {
      const result = await reportConversationAction(initial.id, reason, reportOpen?.messageId);
      if (!result.ok) {
        setReportError(result.error);
        return;
      }
      toast.success(result.message ?? "Report sent");
      setReportOpen(null);
      setReason("");
      router.refresh();
    });
  };

  const confirmRemove = () => {
    if (!removeId) return;
    const id = removeId;
    startRemove(async () => {
      const result = await removeMessageAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: "", removed: true, removedByRole: moderator ? "moderator" : "sender" } : m)));
      setRemoveId(null);
      announceInboxChange();
    });
  };

  const resolve = () => {
    startResolve(async () => {
      const result = await resolveReportAction(initial.id);
      if (result.ok) {
        toast.success(result.message ?? "Report resolved");
        router.refresh();
      } else toast.error(result.error);
    });
  };

  // Render rows: day separators + sender groups.
  const rows: ReactNode[] = [];
  let prevDay = "";
  let prev: MessageView | null = null;
  messages.forEach((m, index) => {
    const day = dayKey(m.createdAt, tz);
    if (day !== prevDay) {
      rows.push(
        <li key={`day-${day}`} className="flex items-center gap-3 py-2" role="separator" aria-label={dayLabel(m.createdAt, tz)}>
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] font-medium text-ink-faint" suppressHydrationWarning>
            {dayLabel(m.createdAt, tz)}
          </span>
          <span className="h-px flex-1 bg-border" />
        </li>,
      );
      prev = null;
    }
    prevDay = day;
    const mine = m.senderId === viewerId;
    const startsGroup = !prev || prev.senderId !== m.senderId || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
    const next = messages[index + 1];
    const endsGroup = !next || next.senderId !== m.senderId || dayKey(next.createdAt, tz) !== day || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > GROUP_GAP_MS;
    const sender = participants.get(m.senderId);
    const reported = moderator && initial.report?.messageId === m.id;
    const menu: DropdownItem[] = [];
    if (!m.removed) {
      if (mine && !moderator) menu.push({ label: "Remove message", icon: <Icon.Trash className="size-4" />, onClick: () => setRemoveId(m.id), destructive: true });
      if (!mine && !moderator && !initial.reportedByViewer) menu.push({ label: "Report message", icon: <Icon.AlertTriangle className="size-4" />, onClick: () => setReportOpen({ messageId: m.id }), destructive: true });
      if (moderator) menu.push({ label: "Remove message", icon: <Icon.Trash className="size-4" />, onClick: () => setRemoveId(m.id), destructive: true });
    }
    rows.push(
      <li key={m.id} className={cn("group flex gap-2", mine ? "flex-row-reverse" : "flex-row", startsGroup ? "mt-3" : "mt-0.5")}>
        {!mine && <span className="w-8 shrink-0">{startsGroup && <Avatar name={sender?.name ?? "?"} src={sender?.avatarUrl} size="sm" />}</span>}
        <div className={cn("flex max-w-[85%] min-w-0 flex-col sm:max-w-[75%]", mine ? "items-end" : "items-start")}>
          {startsGroup && (!mine || moderator) && <span className="mb-0.5 px-1 text-[11px] font-medium text-ink-muted">{sender?.name ?? "Deleted member"}</span>}
          <div className={cn("flex items-center gap-1", mine ? "flex-row-reverse" : "flex-row")}>
            <div
              className={cn(
                "min-w-0 rounded-2xl px-3.5 py-2",
                m.removed ? "border border-dashed border-border bg-transparent text-ink-faint" : mine ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink",
                reported && "ring-2 ring-warning",
              )}
              title={formatDateTime(m.createdAt)}
            >
              {m.removed ? (
                <p className="text-sm italic">{m.removedByRole === "moderator" ? "Removed by a moderator" : "Message removed"}</p>
              ) : (
                <MessageBody body={m.body} mine={mine} />
              )}
            </div>
            {menu.length > 0 && (
              <Dropdown
                align={mine ? "end" : "start"}
                className="opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                trigger={
                  <span className="inline-flex size-7 items-center justify-center rounded-full text-ink-faint hover:bg-surface-2 hover:text-ink">
                    <Icon.MoreHorizontal className="size-4" aria-hidden="true" />
                    <span className="sr-only">Message options</span>
                  </span>
                }
                items={menu}
              />
            )}
          </div>
          {(endsGroup || m.id === seenId) && (
            <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-ink-faint">
              <time dateTime={m.createdAt} suppressHydrationWarning>
                {clock(m.createdAt, tz)}
              </time>
              {mine && m.id === seenId && (
                <>
                  <span aria-hidden="true">·</span>
                  <Icon.Check className="size-3 text-accent" aria-hidden="true" />
                  <span>Seen</span>
                </>
              )}
            </span>
          )}
        </div>
      </li>,
    );
    prev = m;
  });

  for (const p of pending) {
    rows.push(
      <li key={p.id} className="mt-1 flex flex-row-reverse gap-2">
        <div className="flex max-w-[85%] min-w-0 flex-col items-end sm:max-w-[75%]">
          <div className={cn("min-w-0 rounded-2xl px-3.5 py-2 text-accent-fg", p.failed ? "bg-danger/80" : "bg-accent/70")}>
            <MessageBody body={p.body} mine />
          </div>
          {p.failed ? (
            <span className="mt-0.5 flex flex-wrap items-center justify-end gap-2 px-1 text-[11px] text-danger" role="alert">
              {p.failed}
              <button type="button" className="font-medium underline" onClick={() => retry(p)}>
                Retry
              </button>
              <button type="button" className="font-medium underline" onClick={() => setPending((list) => list.filter((x) => x.id !== p.id))}>
                Discard
              </button>
            </span>
          ) : (
            <span className="mt-0.5 px-1 text-[11px] text-ink-faint">Sending…</span>
          )}
        </div>
      </li>,
    );
  }

  const report = initial.report;

  return (
    <section aria-label="Conversation" className="relative flex h-[calc(100dvh-13rem)] min-h-96 flex-col overflow-hidden rounded-card border border-border bg-surface-1 lg:h-[calc(100dvh-12rem)] lg:min-h-112">
      <ThreadHeader thread={initial} others={moderator ? initial.participants : others} onReport={() => setReportOpen({})} onResolve={resolve} resolving={resolving} />

      {moderator && report && (
        <div className={cn("border-b border-border px-4 py-3 text-sm", report.status === "open" ? "bg-warning/10" : "bg-surface-2")}>
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
            <Icon.Shield className="size-4 text-warning" aria-hidden="true" />
            {report.status === "open" ? "Open report" : "Resolved report"}
            {report.count > 1 && <Badge tone="warning" size="xs">{report.count} reports</Badge>}
          </p>
          <p className="mt-1 text-ink-muted">
            {report.reportedBy ? `${report.reportedBy.name} reported this conversation` : "Reported"} on {formatDateTime(report.reportedAt)}
            {report.reason ? `: “${report.reason}”` : "."}
          </p>
          {report.status === "resolved" && report.resolvedAt && (
            <p className="mt-1 text-xs text-ink-faint">
              Resolved {report.resolvedBy ? `by ${report.resolvedBy} ` : ""}on {formatDateTime(report.resolvedAt)}
            </p>
          )}
          {report.status === "open" && (
            <Button size="xs" variant="outline" className="mt-2" onClick={resolve} loading={resolving} leftIcon={<Icon.CheckCircle className="size-3.5" />}>
              Resolve report
            </Button>
          )}
        </div>
      )}
      {!moderator && initial.reportedByViewer && (
        <p className="border-b border-border bg-surface-2 px-4 py-2 text-xs text-ink-muted">You reported this conversation. A moderator will review it.</p>
      )}

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4" aria-live="polite" aria-relevant="additions">
        {hasOlder && (
          <div className="mb-2 flex justify-center">
            <Button variant="ghost" size="xs" onClick={loadOlder} loading={loadingOlder} leftIcon={<Icon.ChevronUp className="size-3.5" />}>
              Earlier messages
            </Button>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-ink-muted">
            <Icon.MessageCircle className="mb-2 size-8 text-ink-faint" />
            No messages in this conversation yet.
          </div>
        ) : (
          <ol className="flex flex-col">{rows}</ol>
        )}
      </div>

      {newBelow && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
          <Button size="xs" className="pointer-events-auto shadow-lg" onClick={() => scrollToBottom(true)} leftIcon={<Icon.ChevronDown className="size-3.5" />}>
            New messages
          </Button>
        </div>
      )}

      <div className="border-t border-border p-2 sm:p-3">
        {replyBlocked ? (
          <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-muted">
            <Icon.Lock className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
            {replyBlocked}
          </p>
        ) : (
          <MessageComposer onSend={send} draftKey={`learnloop:dm-draft:${initial.id}`} autoFocus />
        )}
      </div>

      <Dialog
        open={!!reportOpen}
        onClose={() => {
          setReportOpen(null);
          setReportError(null);
        }}
        title={reportOpen?.messageId ? "Report this message" : "Report this conversation"}
        description="Moderators will read this conversation to check it against the community rules. The other member isn't told who reported it."
        footer={
          <>
            <Button variant="outline" onClick={() => setReportOpen(null)} disabled={reporting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submitReport} loading={reporting} disabled={reason.trim().length < 3}>
              Send report
            </Button>
          </>
        }
      >
        <Field label="What's wrong?" htmlFor="dm-report-reason" error={reportError ?? undefined} hint={`${reason.length}/${MESSAGE_LIMITS.reportReasonMax}`}>
          <Textarea
            id="dm-report-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MESSAGE_LIMITS.reportReasonMax))}
            rows={4}
            placeholder="Spam, harassment, something unsafe…"
            autoFocus
          />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={!!removeId}
        onClose={() => setRemoveId(null)}
        onConfirm={confirmRemove}
        loading={removing}
        destructive
        title="Remove this message?"
        description={moderator ? "The message is replaced with “Removed by a moderator” for everyone in the conversation." : "The message is replaced with “Message removed” for everyone in the conversation."}
        confirmLabel="Remove"
      />

      <IconButton label="Scroll to the newest message" className="sr-only focus:not-sr-only focus:absolute focus:right-3 focus:bottom-24" onClick={() => scrollToBottom()}>
        <Icon.ChevronDown className="size-4" />
      </IconButton>
    </section>
  );
}

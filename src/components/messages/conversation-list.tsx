"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { cn, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { loadInboxAction } from "@/lib/actions/messages";
import { MESSAGE_LIMITS, type InboxFilter } from "@/lib/comms/messages-core";
import type { ConversationSummary, InboxPage } from "@/lib/comms/messages";

/** Fired by an open thread after it sent a message or marked itself read, so the list refreshes at once. */
export const INBOX_CHANGED_EVENT = "learnloop:messages-changed";

export function announceInboxChange(): void {
  window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
}

function activeConversationId(pathname: string): string | null {
  const match = /^\/messages\/([A-Za-z0-9_-]+)$/.exec(pathname);
  return match && match[1] !== "new" ? match[1] : null;
}

/**
 * Two-pane messages layout: the conversation list and the open pane. Below
 * `lg` only one pane shows — the list on /messages, the thread elsewhere.
 */
export function InboxPanes({ list, children }: { list: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const atIndex = pathname === "/messages";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_1fr]">
      <div className={cn(atIndex ? "block" : "hidden lg:block")}>{list}</div>
      <div className={cn("min-w-0", atIndex ? "hidden lg:block" : "block")}>{children}</div>
    </div>
  );
}

function names(c: ConversationSummary): string {
  return c.others.map((o) => o.name).join(", ") || "Just you";
}

function ConversationRow({ c, active }: { c: ConversationSummary; active: boolean }) {
  const first = c.others[0];
  return (
    <li>
      <Link
        href={`/messages/${c.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent",
          active && "bg-accent/10 hover:bg-accent/10",
        )}
      >
        <Avatar name={first?.name ?? "?"} src={first?.avatarUrl} size="md" className={cn(first && !first.active && "opacity-50")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm", c.unread ? "font-semibold text-ink" : "font-medium text-ink")}>{names(c)}</span>
            <time dateTime={c.lastMessageAt} className="shrink-0 text-[11px] text-ink-faint" suppressHydrationWarning>
              {relativeTime(c.lastMessageAt)}
            </time>
          </span>
          {(first?.role || c.courseTitle || c.subject) && (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
              {first?.role && (
                <Badge tone="accent" size="xs">
                  {first.role}
                </Badge>
              )}
              <span className="truncate">{c.subject ?? c.courseTitle}</span>
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-xs", c.unread ? "text-ink" : "text-ink-muted")}>
              {c.previewMine && <span className="text-ink-faint">You: </span>}
              {c.preview}
            </span>
            {c.report === "open" && <Icon.AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Reported" />}
            {c.unread > 0 && (
              <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg" aria-label={`${c.unread} unread`}>
                {c.unread > 99 ? "99+" : c.unread}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Conversation list: search, All/Unread filter, "Load more", and a refresh
 * every 10 seconds while the page is visible (plus right after the open
 * thread changes).
 */
export function ConversationList({ initial }: { initial: InboxPage }) {
  const pathname = usePathname();
  const active = activeConversationId(pathname);
  const [page, setPage] = useState(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [loadingMore, startMore] = useTransition();
  const query = useRef({ q: "", filter: "all" as InboxFilter });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef(initial.items.length);

  useEffect(() => {
    shown.current = page.items.length;
  }, [page.items.length]);

  const refresh = useCallback(async () => {
    const { q: currentQ, filter: currentFilter } = query.current;
    const params = new URLSearchParams({ inbox: "1", q: currentQ, filter: currentFilter, limit: String(Math.max(shown.current, MESSAGE_LIMITS.inboxPage)) });
    try {
      const res = await fetch(`/messages/feed?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { inbox?: InboxPage };
      // Ignore answers to an older query.
      if (data.inbox && query.current.q === currentQ && query.current.filter === currentFilter) setPage(data.inbox);
    } catch {
      // Offline: the next tick tries again.
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(tick, MESSAGE_LIMITS.pollMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener(INBOX_CHANGED_EVENT, tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener(INBOX_CHANGED_EVENT, tick);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const load = (next: { q: string; filter: InboxFilter }) => {
    query.current = next;
    startSearch(async () => {
      const result = await loadInboxAction({ ...next, offset: 0 });
      if (query.current !== next) return;
      if (result.ok) {
        setPage(result.data);
        setError(null);
      } else setError(result.error);
    });
  };

  const onSearch = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load({ q: value.trim(), filter }), 300);
  };

  const onFilter = (value: InboxFilter) => {
    setFilter(value);
    load({ q: q.trim(), filter: value });
  };

  const loadMore = () => {
    const current = query.current;
    startMore(async () => {
      const result = await loadInboxAction({ ...current, offset: page.items.length });
      if (query.current !== current) return;
      if (result.ok) {
        setPage((prev) => {
          const seen = new Set(prev.items.map((c) => c.id));
          return { ...result.data, items: [...prev.items, ...result.data.items.filter((c) => !seen.has(c.id))] };
        });
      } else setError(result.error);
    });
  };

  const filtering = q.trim() !== "" || filter !== "all";

  return (
    <section aria-label="Conversations" className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-1 lg:h-[calc(100dvh-12rem)] lg:min-h-112">
      <div className="space-y-2 border-b border-border p-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name or course"
          aria-label="Search conversations"
          leftAddon={searching ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
        />
        <div role="radiogroup" aria-label="Show" className="flex gap-1">
          {(["all", "unread"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={filter === value}
              onClick={() => onFilter(value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                filter === value ? "bg-ink text-surface-1" : "text-ink-muted hover:bg-surface-2",
              )}
            >
              {value === "all" ? "All" : `Unread${page.unreadTotal ? ` (${page.unreadTotal > 99 ? "99+" : page.unreadTotal})` : ""}`}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="border-b border-border bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {page.items.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
              <Icon.MessageCircle className="size-6" />
            </span>
            <p className="text-sm font-medium text-ink">{filtering ? "No conversations match" : "No messages yet"}</p>
            <p className="mt-1 max-w-56 text-xs text-ink-muted">
              {filtering ? "Try another name, or show all conversations." : "Start a conversation with an instructor of one of your courses."}
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {page.items.map((c) => (
              <ConversationRow key={c.id} c={c} active={c.id === active} />
            ))}
          </ul>
        )}
        {page.hasMore && (
          <div className="p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={loadMore} loading={loadingMore}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

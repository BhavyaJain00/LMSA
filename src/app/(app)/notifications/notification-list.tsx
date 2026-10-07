"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import type { NotificationType } from "@/lib/types";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/actions/notifications";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface NotificationRow {
  id: string;
  type: NotificationType;
  subject: string;
  message?: string;
  link?: string;
  read: boolean;
  createdAt: string;
  /** Pre-formatted on the server ("2 hours ago") to avoid hydration drift. */
  timeLabel: string;
  exactTime: string;
  typeLabel: string;
  from: { name: string; avatarUrl?: string } | null;
}

export interface NotificationGroup {
  key: string;
  label: string;
  items: NotificationRow[];
}

const typeIcon: Record<NotificationType, ReactNode> = {
  enrollment: <Icon.UserPlus />,
  course_published: <Icon.BookOpen />,
  batch_published: <Icon.Users />,
  live_class: <Icon.Radio />,
  assignment_graded: <Icon.ClipboardList />,
  quiz_graded: <Icon.ListChecks />,
  certificate: <Icon.Certificate />,
  badge: <Icon.Award />,
  mention: <Icon.MessageCircle />,
  reply: <Icon.MessageSquare />,
  announcement: <Icon.Megaphone />,
  system: <Icon.Info />,
};

/** "Mark all as read" button (shown only when something is unread). */
export function MarkAllReadButton({ unread }: { unread: number }) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  if (unread === 0) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      leftIcon={<Icon.CheckCircle className="size-4" />}
      onClick={() =>
        startTransition(async () => {
          await markAllNotificationsReadAction();
          toast.success("All notifications marked as read");
        })
      }
    >
      Mark all as read
    </Button>
  );
}

/**
 * Notifications grouped by day. Clicking a row marks it as read (optimistically)
 * and follows its link when it has one.
 */
export function NotificationList({ groups }: { groups: NotificationGroup[] }) {
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [, startTransition] = useTransition();

  const markRead = (id: string) => {
    setReadIds((prev) => new Set(prev).add(id));
    startTransition(() => markNotificationReadAction(id));
  };

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`day-${group.key}`}>
          <h2 id={`day-${group.key}`} className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {group.label}
          </h2>
          <ul className="overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
            {group.items.map((n) => {
              const read = n.read || readIds.has(n.id);
              const inner = (
                <>
                  <span className="mt-2 flex w-2 shrink-0 justify-center" aria-hidden="true">
                    <span className={cn("size-[7px] rounded-full", read ? "bg-transparent" : "bg-accent")} />
                  </span>
                  {n.from ? (
                    <span className="relative shrink-0">
                      <Avatar name={n.from.name} src={n.from.avatarUrl} size="md" />
                      <span className="absolute -bottom-1 -end-1 flex size-5 items-center justify-center rounded-full bg-surface-1 text-ink-muted ring-2 ring-surface-1 [&>svg]:size-3">
                        {typeIcon[n.type]}
                      </span>
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full [&>svg]:size-4.5",
                        read ? "bg-surface-2 text-ink-faint" : "bg-accent/10 text-accent",
                      )}
                    >
                      {typeIcon[n.type]}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", read ? "text-ink-muted" : "font-semibold text-ink")}>{n.subject}</span>
                    {n.message && <span className="mt-0.5 line-clamp-2 block text-sm text-ink-muted">{n.message}</span>}
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
                      <time dateTime={n.createdAt} title={n.exactTime}>
                        {n.timeLabel}
                      </time>
                      <span aria-hidden="true">·</span>
                      <span>{n.typeLabel}</span>
                      {!read && <span className="sr-only">Unread</span>}
                    </span>
                  </span>
                  {n.link && <Icon.ChevronRight className="mt-2.5 size-4 shrink-0 text-ink-faint rtl:rotate-180" />}
                </>
              );
              const classes = cn(
                "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2 sm:px-4",
                !read && "bg-accent/[0.04]",
              );
              return (
                <li key={n.id} className="border-b border-border last:border-0">
                  {n.link ? (
                    <Link href={n.link} className={classes} onClick={() => !read && markRead(n.id)}>
                      {inner}
                    </Link>
                  ) : (
                    <button type="button" className={classes} onClick={() => !read && markRead(n.id)} aria-label={read ? n.subject : `Mark as read: ${n.subject}`}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

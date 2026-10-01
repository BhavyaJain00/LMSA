"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/actions/notifications";
import { useFormatter, useT } from "@/i18n/client";

const typeIcon: Record<Notification["type"], React.ReactNode> = {
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

export function NotificationsBell({ notifications, unread }: { notifications: Notification[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const t = useT("shell");
  const format = useFormatter();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
        aria-label={t("notifications.labelUnread", { count: unread })}
        aria-expanded={open}
      >
        <Icon.Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute inset-e-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-accent-fg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute inset-e-0 z-50 mt-1.5 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-border bg-surface-1 shadow-pop animate-scale-in">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">{t("notifications.title")}</p>
            {unread > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => markAllNotificationsReadAction())}
                className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
              >
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto scrollbar-thin">
            {notifications.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-muted">{t("notifications.empty")}</li>}
            {notifications.map((n) => {
              const inner = (
                <>
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-4", n.read ? "bg-surface-2 text-ink-faint" : "bg-accent/10 text-accent")}>
                    {typeIcon[n.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", n.read ? "text-ink-muted" : "font-medium text-ink")}>{n.subject}</span>
                    {n.message && <span className="block truncate text-xs text-ink-muted">{n.message}</span>}
                    <span className="block text-[11px] text-ink-faint">{format.relative(n.createdAt)}</span>
                  </span>
                  {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" />}
                </>
              );
              const classes = "flex w-full items-start gap-3 px-3 py-2.5 text-start transition-colors hover:bg-surface-2";
              return (
                <li key={n.id} className="border-b border-border last:border-0">
                  {n.link ? (
                    <Link
                      href={n.link}
                      className={classes}
                      onClick={() => {
                        setOpen(false);
                        if (!n.read) startTransition(() => markNotificationReadAction(n.id));
                      }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <button type="button" className={classes} onClick={() => !n.read && startTransition(() => markNotificationReadAction(n.id))}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-3 py-2 text-center text-xs font-medium text-accent hover:bg-surface-2">
            {t("notifications.viewAll")}
          </Link>
        </div>
      )}
    </div>
  );
}

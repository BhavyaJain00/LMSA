import Link from "next/link";
import { notFound } from "next/navigation";
import type { Notification, NotificationType } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";
import { all, getSettings } from "@/lib/db/store";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { addDays, cn, formatDateTime, relativeTime, toDateKey } from "@/lib/utils";
import { MarkAllReadButton, NotificationList, type NotificationGroup } from "./notification-list";

export const metadata = { title: "Notifications" };

const typeLabels: Record<NotificationType, string> = {
  enrollment: "Enrollments",
  course_published: "New courses",
  batch_published: "New batches",
  live_class: "Live classes",
  assignment_graded: "Assignments",
  quiz_graded: "Quizzes",
  certificate: "Certificates",
  badge: "Badges",
  mention: "Mentions",
  reply: "Replies",
  announcement: "Announcements",
  system: "Updates",
};

const PAGE_SIZE = 50;

function dayLabel(key: string, today: string, yesterday: string): string {
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const d = new Date(`${key}T00:00:00`);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: sameYear ? undefined : "numeric" });
}

function buildHref(params: { tab?: string; type?: string; limit?: number }): string {
  const qs = new URLSearchParams();
  if (params.tab && params.tab !== "all") qs.set("tab", params.tab);
  if (params.type) qs.set("type", params.type);
  if (params.limit && params.limit > PAGE_SIZE) qs.set("limit", String(params.limit));
  const s = qs.toString();
  return s ? `/notifications?${s}` : "/notifications";
}

export default async function NotificationsPage(props: PageProps<"/notifications">) {
  const user = await requireUser("/notifications");
  const settings = await getSettings();
  if (!settings.features.notifications) notFound();

  const sp = await props.searchParams;
  const tab = sp.tab === "unread" || sp.tab === "read" ? sp.tab : "all";
  const typeParam = typeof sp.type === "string" && sp.type in typeLabels ? (sp.type as NotificationType) : undefined;
  const limit = Math.min(1000, Math.max(PAGE_SIZE, Number(sp.limit) || PAGE_SIZE));

  const [notifications, users] = await Promise.all([all("notifications"), all("users")]);
  const mine = notifications.filter((n) => n.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = mine.filter((n) => !n.read).length;
  const typeCounts = new Map<NotificationType, number>();
  for (const n of mine) typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1);

  const filtered = mine.filter((n) => {
    if (tab === "unread" && n.read) return false;
    if (tab === "read" && !n.read) return false;
    if (typeParam && n.type !== typeParam) return false;
    return true;
  });
  const visible = filtered.slice(0, limit);

  const byId = new Map(users.map((u) => [u.id, u]));
  const today = toDateKey();
  const yesterday = toDateKey(addDays(new Date(), -1));
  const groups: NotificationGroup[] = [];
  for (const n of visible as Notification[]) {
    const key = toDateKey(new Date(n.createdAt));
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(key, today, yesterday), items: [] };
      groups.push(group);
    }
    const from = n.fromUserId ? byId.get(n.fromUserId) : undefined;
    group.items.push({
      id: n.id,
      type: n.type,
      subject: n.subject,
      message: n.message,
      link: n.link,
      read: n.read,
      createdAt: n.createdAt,
      timeLabel: relativeTime(n.createdAt),
      exactTime: formatDateTime(n.createdAt),
      typeLabel: typeLabels[n.type],
      from: from ? { name: from.name, avatarUrl: from.avatarUrl } : null,
    });
  }

  const emptyCopy =
    tab === "unread"
      ? { title: "No unread notifications", description: "You're all caught up! Check back later for updates." }
      : tab === "read"
        ? { title: "No read notifications", description: "Notifications you have read will appear here." }
        : { title: "No notifications yet", description: "Announcements, grades, replies, badges and live class reminders will show up here." };

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        title="Notifications"
        description={unread ? `You have ${unread} unread ${unread === 1 ? "notification" : "notifications"}.` : "You're all caught up."}
        actions={<MarkAllReadButton unread={unread} />}
      />

      <Tabs
        className="mb-4"
        items={[
          { label: "All", value: "all", count: mine.length },
          { label: "Unread", value: "unread", count: unread },
          { label: "Read", value: "read", count: mine.length - unread },
        ]}
      />

      {typeCounts.size > 1 && (
        <nav aria-label="Filter by type" className="no-scrollbar -mx-1 mb-6 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Link
            href={buildHref({ tab })}
            aria-current={!typeParam ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              !typeParam ? "border-ink bg-ink text-surface-1" : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
            )}
          >
            All types
          </Link>
          {Array.from(typeCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <Link
                key={type}
                href={buildHref({ tab, type })}
                aria-current={typeParam === type ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  typeParam === type ? "border-ink bg-ink text-surface-1" : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
                )}
              >
                {typeLabels[type]}
                <span className="tabular-nums opacity-70">{count}</span>
              </Link>
            ))}
        </nav>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={<Icon.Bell />}
          title={typeParam ? `No ${typeLabels[typeParam].toLowerCase()} here` : emptyCopy.title}
          description={typeParam ? "Try another type or tab." : emptyCopy.description}
          action={
            typeParam || tab !== "all" ? (
              <ButtonLink href="/notifications" variant="outline" size="sm">
                Show all notifications
              </ButtonLink>
            ) : (
              <ButtonLink href="/dashboard" variant="outline" size="sm">
                Go to dashboard
              </ButtonLink>
            )
          }
        />
      ) : (
        <>
          <NotificationList groups={groups} />
          {filtered.length > visible.length && (
            <div className="mt-6 flex justify-center">
              <ButtonLink href={buildHref({ tab, type: typeParam, limit: limit + PAGE_SIZE })} variant="outline" size="sm" prefetch={false}>
                Show older notifications ({filtered.length - visible.length} more)
              </ButtonLink>
            </div>
          )}
        </>
      )}
    </div>
  );
}

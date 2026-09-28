import Link from "next/link";
import type { ReactNode } from "react";
import type { ActivityFeedItem, ActivityKind, RecentEnrollment, RecentSignup } from "@/lib/data/dashboard";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, StatCard } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { roleLabels } from "@/lib/config";
import { cn, relativeTime } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* KPI card (StatCard, optionally clickable)                            */
/* ------------------------------------------------------------------ */

export function KpiCard({
  href,
  label,
  value,
  hint,
  icon,
  trend,
}: {
  href?: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  trend?: { value: number; label?: string };
}) {
  const card = <StatCard label={label} value={value} hint={hint} icon={icon} trend={trend} className="h-full" />;
  if (!href) return card;
  return (
    <Link href={href} className="block h-full rounded-card transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent">
      {card}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Quick links                                                          */
/* ------------------------------------------------------------------ */

export interface QuickLink {
  label: string;
  description: string;
  href: string;
  icon: IconName;
  count?: number;
  highlight?: boolean;
}

export function QuickLinksGrid({ links }: { links: QuickLink[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {links.map((link) => {
        const IconCmp = Icon[link.icon];
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              className="group flex h-full items-start gap-3 rounded-xl border border-border bg-surface-1 p-3 transition-colors hover:border-border-strong hover:bg-surface-2/60"
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  link.highlight ? "bg-warning/15 text-warning" : "bg-accent/10 text-accent",
                )}
                aria-hidden="true"
              >
                <IconCmp className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink group-hover:text-accent">{link.label}</span>
                  {link.count !== undefined && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums",
                        link.highlight ? "bg-warning/15 text-warning" : "bg-surface-3 text-ink-muted",
                      )}
                    >
                      {link.count}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">{link.description}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Recent enrollments                                                   */
/* ------------------------------------------------------------------ */

export function RecentEnrollmentsTable({ rows }: { rows: RecentEnrollment[] }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Learner</TH>
          <TH>Course</TH>
          <TH className="hidden sm:table-cell">Enrolled</TH>
          <TH className="w-36">Progress</TH>
        </tr>
      </THead>
      <TBody>
        {rows.length === 0 && <TableEmpty colSpan={4}>No enrollments yet. New learners will show up here as they join your courses.</TableEmpty>}
        {rows.map((r) => (
          <TR key={r.id}>
            <TD>
              {r.user ? (
                <Link href={`/user/${r.user.username}`} className="flex min-w-0 items-center gap-2.5 hover:text-accent">
                  <Avatar name={r.user.name} src={r.user.avatarUrl} size="sm" />
                  <span className="max-w-40 truncate font-medium">{r.user.name}</span>
                </Link>
              ) : (
                <span className="text-ink-muted">Deleted user</span>
              )}
            </TD>
            <TD>
              <Link href={`/courses/${r.course.slug}`} className="line-clamp-2 min-w-40 hover:text-accent">
                {r.course.title}
              </Link>
              {r.batchTitle && <span className="block truncate text-xs text-ink-muted">via {r.batchTitle}</span>}
            </TD>
            <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{relativeTime(r.enrolledAt)}</TD>
            <TD>
              {r.completed ? (
                <Badge tone="success" dot>
                  Completed
                </Badge>
              ) : (
                <div className="flex items-center gap-2">
                  <ProgressBar value={r.progress} size="xs" label={`${r.user?.name ?? "Learner"} progress`} />
                  <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-muted">{r.progress}%</span>
                </div>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/* ------------------------------------------------------------------ */
/* Recent signups                                                       */
/* ------------------------------------------------------------------ */

export function RecentSignupsList({ users, showEmail }: { users: RecentSignup[]; showEmail: boolean }) {
  return (
    <Card className="h-full">
      {users.length === 0 ? (
        <div className="p-4">
          <EmptyState compact icon={<Icon.UserPlus />} title="No members yet" description="People who sign up will appear here." />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {users.map((u) => (
            <li key={u.id}>
              <Link href={`/user/${u.username}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{u.name}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {showEmail && u.email ? u.email : `@${u.username}`} · {u.enrollments} {u.enrollments === 1 ? "course" : "courses"}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[11px] text-ink-faint">{relativeTime(u.createdAt)}</span>
                  {u.roles.some((r) => r !== "student") && (
                    <Badge tone="accent" size="xs">
                      {roleLabels[u.roles.find((r) => r !== "student")!] ?? "Staff"}
                    </Badge>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                        */
/* ------------------------------------------------------------------ */

const activityIcon: Record<ActivityKind, { icon: ReactNode; tone: string }> = {
  signup: { icon: <Icon.UserPlus />, tone: "bg-info/10 text-info" },
  enrollment: { icon: <Icon.BookOpen />, tone: "bg-accent/10 text-accent" },
  batch_enrollment: { icon: <Icon.Users />, tone: "bg-accent/10 text-accent" },
  completion: { icon: <Icon.Trophy />, tone: "bg-success/10 text-success" },
  certificate: { icon: <Icon.Certificate />, tone: "bg-success/10 text-success" },
  quiz: { icon: <Icon.ListChecks />, tone: "bg-warning/15 text-warning" },
  assignment: { icon: <Icon.ClipboardList />, tone: "bg-warning/15 text-warning" },
  review: { icon: <Icon.Star />, tone: "bg-warning/15 text-warning" },
  payment: { icon: <Icon.CreditCard />, tone: "bg-success/10 text-success" },
};

export function ActivityFeed({ items }: { items: ActivityFeedItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Icon.Zap />}
        title="No activity yet"
        description="Enrollments, submissions, certificates and reviews will show up here as they happen."
      />
    );
  }
  return (
    <Card className="p-4">
      <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
        {items.map((item) => {
          const meta = activityIcon[item.kind];
          return (
            <li key={item.id} className="relative flex gap-3">
              <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface-1 [&>svg]:size-4", meta.tone)} aria-hidden="true">
                {meta.icon}
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-sm text-ink-muted">
                  {item.actor ? (
                    <Link href={`/user/${item.actor.username}`} className="font-medium text-ink hover:text-accent">
                      {item.actor.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">Someone</span>
                  )}{" "}
                  {item.verb}
                  {item.target && (
                    <>
                      {" "}
                      <Link href={item.target.href} className="font-medium text-ink hover:text-accent">
                        {item.target.label}
                      </Link>
                    </>
                  )}
                </p>
                {item.detail && <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{item.detail}</p>}
                <p className="mt-0.5 text-[11px] text-ink-faint">{relativeTime(item.at)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

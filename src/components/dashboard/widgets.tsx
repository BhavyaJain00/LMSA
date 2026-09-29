import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardBadge, DashboardCertificate, PendingItem, PendingStatus } from "@/lib/data/dashboard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { cn, formatDate, toDateKey } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Your rank (points & leaderboard)                                     */
/* ------------------------------------------------------------------ */

/**
 * Async server component: weekly/all-time rank, level progress and the
 * latest points award. Renders nothing while points are turned off.
 * Usage in the dashboard sidebar: `<YourRankWidget user={user} />`.
 */
export { YourRankWidget } from "@/components/gamification/your-rank-widget";

/* ------------------------------------------------------------------ */
/* Pending work                                                         */
/* ------------------------------------------------------------------ */

const kindIcon: Record<PendingItem["kind"], ReactNode> = {
  quiz: <Icon.ListChecks />,
  assignment: <Icon.ClipboardList />,
  exercise: <Icon.Code />,
};
const kindLabel: Record<PendingItem["kind"], string> = {
  quiz: "Quiz",
  assignment: "Assignment",
  exercise: "Exercise",
};
const statusCopy: Record<PendingStatus, { label: string; tone: "neutral" | "warning" | "info" }> = {
  not_started: { label: "Not started", tone: "neutral" },
  retry: { label: "Try again", tone: "warning" },
  awaiting_grading: { label: "Awaiting grading", tone: "info" },
};

export function PendingWorkList({ items, total }: { items: PendingItem[]; total: number }) {
  const today = toDateKey();
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const overdue = !!item.dueDate && item.dueDate < today && item.status !== "awaiting_grading";
          return (
            <li key={item.key}>
              <Link href={item.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4.5",
                    item.status === "awaiting_grading" ? "bg-info/10 text-info" : "bg-accent/10 text-accent",
                  )}
                  aria-hidden="true"
                >
                  {kindIcon[item.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {kindLabel[item.kind]} · {item.context}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={statusCopy[item.status].tone} size="xs">
                    {statusCopy[item.status].label}
                  </Badge>
                  {item.dueDate && (
                    <span className={cn("text-[11px]", overdue ? "font-medium text-danger" : "text-ink-faint")}>
                      {overdue ? "Overdue · " : "Due "}
                      {formatDate(item.dueDate, { year: undefined })}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {total > items.length && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-ink-muted">
          And {total - items.length} more in your courses and batches.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Badges                                                               */
/* ------------------------------------------------------------------ */

export function RecentBadges({ badges, total, profileHref }: { badges: DashboardBadge[]; total: number; profileHref: string }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Recent badges</h2>
        {total > 0 && (
          <Link href={`${profileHref}/badges`} className="text-xs font-medium text-ink-muted hover:text-accent">
            View all ({total})
          </Link>
        )}
      </div>
      {badges.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
          <Icon.Award className="size-6 shrink-0 text-ink-faint" />
          <p className="text-xs text-ink-muted">Complete lessons, pass quizzes and keep your streak going to earn badges.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-4 gap-2">
          {badges.map((b) => (
            <li key={`${b.id}-${b.issuedOn}`} className="flex flex-col items-center text-center" title={`${b.title} — ${b.description}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.imageUrl} alt="" className="size-12 object-contain" loading="lazy" />
              <span className="mt-1 line-clamp-2 text-[11px] font-medium leading-tight text-ink">{b.title}</span>
              <span className="text-[10px] text-ink-faint">{formatDate(b.issuedOn, { year: undefined })}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Certificates                                                         */
/* ------------------------------------------------------------------ */

export function CertificateList({ certificates, profileHref }: { certificates: DashboardCertificate[]; profileHref: string }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Certificates</h2>
        {certificates.length > 0 && (
          <Link href={`${profileHref}/certificates`} className="text-xs font-medium text-ink-muted hover:text-accent">
            View all
          </Link>
        )}
      </div>
      {certificates.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
          <Icon.Certificate className="size-6 shrink-0 text-ink-faint" />
          <p className="text-xs text-ink-muted">Finish a course with certification enabled to earn your first certificate.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {certificates.slice(0, 4).map((c) => (
            <li key={c.id}>
              <Link href={`/certificates/${c.code}`} className="flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-surface-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                  <Icon.Certificate className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{c.title}</span>
                  <span className="block text-xs text-ink-muted">Issued on {formatDate(c.issueDate)}</span>
                </span>
                <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Small stat tiles                                                     */
/* ------------------------------------------------------------------ */

export function MiniStat({ icon, label, value, href }: { icon: ReactNode; label: string; value: ReactNode; href?: string }) {
  const inner = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent [&>svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold leading-tight tabular-nums text-ink">{value}</span>
        <span className="block truncate text-xs text-ink-muted">{label}</span>
      </span>
    </>
  );
  const classes = "flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3";
  return href ? (
    <Link href={href} className={cn(classes, "transition-colors hover:border-border-strong")}>
      {inner}
    </Link>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardBadge, DashboardCertificate, PendingItem, PendingStatus } from "@/lib/data/dashboard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getT } from "@/i18n/server";
import { cn, toDateKey } from "@/lib/utils";

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
const kindLabel = {
  quiz: "dashboard.pending.kindQuiz",
  assignment: "dashboard.pending.kindAssignment",
  exercise: "dashboard.pending.kindExercise",
} as const satisfies Record<PendingItem["kind"], string>;
const statusCopy = {
  not_started: { label: "dashboard.pending.notStarted", tone: "neutral" },
  retry: { label: "dashboard.pending.retry", tone: "warning" },
  awaiting_grading: { label: "dashboard.pending.awaitingGrading", tone: "info" },
} as const satisfies Record<PendingStatus, { label: string; tone: "neutral" | "warning" | "info" }>;

export async function PendingWorkList({ items, total }: { items: PendingItem[]; total: number }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
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
                    {t(kindLabel[item.kind])} · {item.context}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={statusCopy[item.status].tone} size="xs">
                    {t(statusCopy[item.status].label)}
                  </Badge>
                  {item.dueDate && (
                    <span className={cn("text-[11px]", overdue ? "font-medium text-danger" : "text-ink-faint")}>
                      {overdue
                        ? t("dashboard.pending.overdue", { date: f.date(item.dueDate, { year: undefined }) })
                        : t("dashboard.pending.due", { date: f.date(item.dueDate, { year: undefined }) })}
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
          {t("dashboard.pending.more", { count: total - items.length })}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Badges                                                               */
/* ------------------------------------------------------------------ */

export async function RecentBadges({ badges, total, profileHref }: { badges: DashboardBadge[]; total: number; profileHref: string }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{t("dashboard.badges.title")}</h2>
        {total > 0 && (
          <Link href={`${profileHref}/badges`} className="text-xs font-medium text-ink-muted hover:text-accent">
            {t("dashboard.badges.viewAll", { count: total })}
          </Link>
        )}
      </div>
      {badges.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
          <Icon.Award className="size-6 shrink-0 text-ink-faint" />
          <p className="text-xs text-ink-muted">{t("dashboard.badges.empty")}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-4 gap-2">
          {badges.map((b) => (
            <li key={`${b.id}-${b.issuedOn}`} className="flex flex-col items-center text-center" title={t("dashboard.badges.tooltip", { title: b.title, description: b.description })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.imageUrl} alt="" className="size-12 object-contain" loading="lazy" />
              <span className="mt-1 line-clamp-2 text-[11px] font-medium leading-tight text-ink">{b.title}</span>
              <span className="text-[10px] text-ink-faint">{f.date(b.issuedOn, { year: undefined })}</span>
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

export async function CertificateList({ certificates, profileHref }: { certificates: DashboardCertificate[]; profileHref: string }) {
  const [t, tc, f] = await Promise.all([getT("account"), getT("common"), getFormatter()]);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{t("dashboard.certificates.title")}</h2>
        {certificates.length > 0 && (
          <Link href={`${profileHref}/certificates`} className="text-xs font-medium text-ink-muted hover:text-accent">
            {tc("actions.viewAll")}
          </Link>
        )}
      </div>
      {certificates.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 p-3">
          <Icon.Certificate className="size-6 shrink-0 text-ink-faint" />
          <p className="text-xs text-ink-muted">{t("dashboard.certificates.empty")}</p>
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
                  <span className="block text-xs text-ink-muted">{t("dashboard.certificates.issuedOn", { date: f.date(c.issueDate) })}</span>
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

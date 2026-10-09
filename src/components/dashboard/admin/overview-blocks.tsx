import Link from "next/link";
import type { ReactNode } from "react";
import type { RecentEnrollment } from "@/lib/data/dashboard";
import { Avatar } from "@/components/ui/avatar";
import { Icon, type IconName } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { getFormatter, getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

/*
 * Building blocks of the staff overview (/admin). The page answers "what needs me today?": a few quiet numbers,
 * one list of pending work, the next live classes and the latest enrollments. Every staff tool lives in the
 * sidebar's "Manage" group, so nothing here is a directory of links.
 */

const listCard = "overflow-hidden rounded-card border border-border bg-surface-1 shadow-card";

/* ------------------------------------------------------------------ */
/* Section                                                              */
/* ------------------------------------------------------------------ */

/** One overview section: a bold heading, an optional one-line description and an optional "View all →" link. */
export function OverviewSection({
  id,
  title,
  description,
  href,
  linkLabel,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="min-w-0">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-heading font-bold text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-meta text-ink-faint">{description}</p>}
        </div>
        {href && linkLabel && (
          <Link href={href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-accent hover:underline sm:min-h-0">
            {linkLabel}
            <Icon.ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tile                                                            */
/* ------------------------------------------------------------------ */

/** A small, quiet number tile (no icon). Clickable when `href` is given. */
export function StatTile({
  href,
  label,
  value,
  hint,
  trend,
}: {
  href?: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Change in percent; its label replaces the hint ("+20% vs 4 last week"). */
  trend?: { value: number; label: string };
}) {
  const body = (
    <>
      <span className="block truncate text-meta font-medium text-ink-muted">{label}</span>
      <span className="mt-1 block text-2xl font-bold tracking-tight text-ink tabular-nums">{value}</span>
      {(trend || hint) && (
        <span className="mt-1 block text-xs text-ink-faint">
          {trend && (
            <span className={cn("font-semibold tabular-nums", trend.value >= 0 ? "text-success" : "text-danger")}>
              {trend.value >= 0 ? "+" : "−"}
              {Math.abs(trend.value)}%{" "}
            </span>
          )}
          {trend?.label ?? hint}
        </span>
      )}
    </>
  );
  const base = "block h-full rounded-card border border-border bg-surface-1 p-4 sm:p-5";
  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link href={href} className={cn(base, "transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent")}>
      {body}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Needs your attention                                                 */
/* ------------------------------------------------------------------ */

export interface AttentionItem {
  key: string;
  label: string;
  description: string;
  count: number;
  icon: IconName;
  /** Omitted when the viewer's role cannot open the queue. */
  href?: string;
}

/** One list of pending work. Rows with a zero count are hidden; with none left it says "You're all caught up". */
export async function AttentionList({ items }: { items: AttentionItem[] }) {
  const [t, f] = await Promise.all([getT("admin"), getFormatter()]);
  const visible = items.filter((item) => item.count > 0);

  if (visible.length === 0) {
    return (
      <div className={cn(listCard, "flex items-center gap-3 px-4 py-4 sm:gap-4 sm:px-5")}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success" aria-hidden="true">
          <Icon.CheckCircle className="size-5" />
        </span>
        <p className="text-ink-muted">{t("pages.overview.attention.caughtUp")}</p>
      </div>
    );
  }

  return (
    <ul className={cn(listCard, "divide-y divide-border")}>
      {visible.map((item) => {
        const IconCmp = Icon[item.icon];
        const content = (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning" aria-hidden="true">
              <IconCmp className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block font-semibold text-ink", item.href && "group-hover:text-accent")}>{item.label}</span>
              <span className="block truncate text-meta text-ink-faint">{item.description}</span>
            </span>
            <span className="min-w-9 shrink-0 rounded-full bg-surface-2 px-2.5 py-0.5 text-center text-sm font-bold text-ink tabular-nums">
              {f.number(item.count)}
            </span>
            {item.href && <Icon.ChevronRight className="size-4 shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" />}
          </>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:gap-4 sm:px-5">
                {content}
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Coming up                                                            */
/* ------------------------------------------------------------------ */

/** Frame for the "Coming up" rows (`OverviewEventRow`, a client component that knows the viewer's time). */
export function EventList({ children }: { children: ReactNode }) {
  return <ul className={cn(listCard, "divide-y divide-border")}>{children}</ul>;
}

/* ------------------------------------------------------------------ */
/* Recent enrollments                                                   */
/* ------------------------------------------------------------------ */

/** Compact rows: avatar, learner, course, progress and when they enrolled. */
export async function RecentEnrollmentsList({ rows, empty }: { rows: RecentEnrollment[]; empty: ReactNode }) {
  const [t, f] = await Promise.all([getT("account"), getFormatter()]);
  if (rows.length === 0) {
    return <div className={cn(listCard, "px-4 py-5 text-ink-muted sm:px-5")}>{empty}</div>;
  }
  return (
    <ul className={cn(listCard, "divide-y divide-border")}>
      {rows.map((r) => {
        const name = r.user?.name ?? t("dashboard.admin.deletedUser");
        return (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
            <span aria-hidden="true" className="shrink-0">
              <Avatar name={name} src={r.user?.avatarUrl} size="md" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">
                {r.user ? (
                  <Link href={`/user/${r.user.username}`} className="hover:text-accent">
                    {name}
                  </Link>
                ) : (
                  <span className="text-ink-muted">{name}</span>
                )}
              </span>
              <span className="block truncate text-meta text-ink-faint">
                <Link href={`/courses/${r.course.slug}`} className="hover:text-accent">
                  {r.course.title}
                </Link>
                {r.batchTitle && <> · {t("dashboard.admin.viaBatch", { title: r.batchTitle })}</>}
              </span>
            </span>
            <span className="flex w-24 shrink-0 flex-col items-end gap-1 sm:w-36">
              {r.completed ? (
                <span className="text-meta font-semibold text-success">{t("dashboard.admin.completed")}</span>
              ) : (
                <span className="flex w-full items-center gap-2">
                  <ProgressBar value={r.progress} size="xs" label={t("dashboard.cards.progressLabel", { title: name })} />
                  <span className="shrink-0 text-xs font-medium text-ink-muted tabular-nums">{f.percent(r.progress)}</span>
                </span>
              )}
              <span className="text-xs whitespace-nowrap text-ink-faint">{f.relative(r.enrolledAt)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

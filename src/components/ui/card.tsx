import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border bg-surface-1 shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border px-5 py-4", className)}>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}

/** Stat tile used on dashboards. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  trend?: { value: number; label?: string };
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        {icon && <span className="rounded-lg bg-accent/10 p-2 text-accent">{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</p>
      {(hint || trend) && (
        <p className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
          {trend && (
            <span className={cn("font-medium", trend.value >= 0 ? "text-success" : "text-danger")}>
              {trend.value >= 0 ? "▲" : "▼"} {Math.abs(trend.value)}%
            </span>
          )}
          {trend?.label ?? hint}
        </p>
      )}
    </Card>
  );
}

/**
 * Page title block: the only `<h1>` renderer on app pages (`text-title`).
 * Optional eyebrow and breadcrumbs above, description below, actions at the
 * end (they wrap under the title on phones).
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumbs}
        {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
        <h1 className="text-title text-balance text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Section heading: the `<h2>` renderer for page sections (`text-heading`), with optional description and actions. */
export function SectionTitle({
  children,
  actions,
  description,
  id,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
  /** Id of the `<h2>`, for `aria-labelledby` on the section. */
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", description && "items-end", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-heading text-ink">
          {children}
        </h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Small label above a heading ("FEATURED", "TAUGHT BY"). One style for the
 * whole app: accent by default, `muted` on busy backgrounds. Not a heading.
 */
export function Eyebrow({ children, tone = "accent", className }: { children: ReactNode; tone?: "accent" | "muted"; className?: string }) {
  return (
    <p className={cn("text-micro font-semibold tracking-wider uppercase", tone === "accent" ? "text-accent" : "text-ink-muted", className)}>{children}</p>
  );
}

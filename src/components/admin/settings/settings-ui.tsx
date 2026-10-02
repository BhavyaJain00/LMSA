import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { BreadcrumbNav } from "./breadcrumb-nav";

/**
 * Presentational building blocks for the settings pages (usable from both
 * Server and Client Components). Layout mirrors Frappe's settings panels:
 * sections with a heading and divided rows of "label + description | control".
 */

export function SettingsPanelHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SettingsSection({ title, description, children, className, actions }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-card border border-border bg-surface-1 shadow-card", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title && <h3 className="text-base font-semibold text-ink">{title}</h3>}
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/** One settings row. `stacked` puts the control under the label (for wide fields). */
export function SettingsRow({
  label,
  description,
  htmlFor,
  error,
  required,
  stacked,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  stacked?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-4 sm:px-5", !stacked && "sm:flex sm:items-start sm:justify-between sm:gap-6", className)}>
      <div className={cn("min-w-0", !stacked && "sm:max-w-md sm:flex-1")}>
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className={cn("mt-2", stacked ? "w-full" : "sm:mt-0 sm:w-72 sm:shrink-0")}>
        {children}
        {error && (
          <p className="mt-1.5 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Row holding a Switch: the switch already renders its own label and description. */
export function SettingsSwitchRow({ children, error }: { children: ReactNode; error?: string }) {
  return (
    <div className="px-4 py-4 sm:px-5">
      {children}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

export interface Crumb {
  label: ReactNode;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <BreadcrumbNav className={cn("mb-2", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="truncate hover:text-ink hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={cn("truncate", last && "font-medium text-ink")} aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <Icon.ChevronRight className="size-3.5 shrink-0 text-ink-faint" />}
            </li>
          );
        })}
      </ol>
    </BreadcrumbNav>
  );
}

/** Small key/value line used in detail panels. */
export function DetailItem({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

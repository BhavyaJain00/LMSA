import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

/** Titled dashboard block with an optional "See all" link (mirrors Frappe's home sections). */
export async function DashboardSection({
  title,
  description,
  href,
  linkLabel,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  linkLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  const t = await getT("account");
  return (
    <section className={cn("min-w-0", className)} aria-labelledby={headingId} id={id}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {href && (
            <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-accent">
              {linkLabel ?? t("dashboard.section.seeAll")}
              <Icon.ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

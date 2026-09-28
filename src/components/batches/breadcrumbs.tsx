import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";

/** Simple breadcrumb trail; the last item is the current page. */
export function Breadcrumbs({ items, className }: { items: { label: string; href?: string }[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-3 min-w-0", className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-ink-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${item.label}-${i}`}>
              <li className={cn("min-w-0", last && "truncate")}>
                {item.href && !last ? (
                  <Link href={item.href} className="hover:text-ink hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={cn(last && "font-medium text-ink")}>
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="text-ink-faint">
                  <Icon.ChevronRight className="size-3.5" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

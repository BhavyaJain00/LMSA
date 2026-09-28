import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/ui/icons";

export interface Crumb {
  label: string;
  href?: string;
}

/** Small breadcrumb trail for PageHeader. The last crumb is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${item.label}-${i}`}>
              <li className="min-w-0">
                {item.href && !last ? (
                  <Link href={item.href} className="truncate hover:text-ink hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={last ? "truncate font-medium text-ink" : "truncate"}>
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

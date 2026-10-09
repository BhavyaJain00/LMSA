import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TeachingRowData {
  key: string;
  icon: ReactNode;
  label: string;
  value: number;
  /** Plain text (no link) when the viewer cannot open the linked page. */
  href?: string;
}

/** Staff snapshot on the home page: a few counts, each linking to the page where the work happens. */
export function TeachingList({ rows }: { rows: TeachingRowData[] }) {
  const rowClass = "flex items-center gap-3 px-4 py-3 sm:px-5";
  return (
    <ul className="grid divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1 shadow-card sm:grid-cols-2 sm:divide-y-0">
      {rows.map((row, i) => {
        const content = (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted [&>svg]:size-5" aria-hidden="true">
              {row.icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{row.label}</span>
            <span className="shrink-0 text-lg font-bold tabular-nums text-ink">{row.value}</span>
          </>
        );
        return (
          <li key={row.key} className={cn(i >= 2 && "sm:border-t sm:border-border", i % 2 === 0 && "sm:border-e sm:border-border")}>
            {row.href ? (
              <Link href={row.href} className={`${rowClass} transition-colors hover:bg-surface-2`}>
                {content}
              </Link>
            ) : (
              <div className={rowClass}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import Link, { useLinkStatus } from "next/link";
import { Spinner } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export interface CatalogTabLink {
  value: string;
  label: string;
  description: string;
  href: string;
  count?: number;
  active: boolean;
}

function TabInner({ tab }: { tab: CatalogTabLink }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {tab.label}
      {pending ? (
        <Spinner className="size-3" />
      ) : (
        tab.count !== undefined && (
          <span
            className={cn(
              "rounded-full px-1.5 py-px text-[11px] tabular-nums",
              tab.active ? "bg-accent/15 text-accent" : "bg-surface-3 text-ink-muted",
            )}
          >
            {tab.count}
          </span>
        )
      )}
    </>
  );
}

/** Segmented tab strip for the catalog (Live / Upcoming / New / Enrolled / Created / Unpublished). */
export function CatalogTabs({ tabs }: { tabs: CatalogTabLink[] }) {
  const t = useT("public");
  return (
    <nav aria-label={t("catalog.tabs.label")} className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="inline-flex min-w-max gap-1 rounded-xl bg-surface-2 p-1">
        {tabs.map((tab) => (
          <li key={tab.value}>
            <Link
              href={tab.href}
              scroll={false}
              title={tab.description}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
                tab.active ? "bg-surface-1 text-ink shadow-sm" : "text-ink-muted hover:bg-surface-1/60 hover:text-ink",
              )}
            >
              <TabInner tab={tab} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import Link from "next/link";
import type { CommunityTab } from "@/lib/data/community";
import { cn } from "@/lib/utils";

const TAB_LABELS: Record<CommunityTab, string> = {
  latest: "Latest",
  unanswered: "Unanswered",
  mine: "Mine",
};

/**
 * Latest / Unanswered / Mine. Server-rendered links that keep the space
 * filter and search but reset the page (the shared URL tabs keep `page`).
 */
export function HubTabs({ active, counts, hrefFor }: { active: CommunityTab; counts: Record<CommunityTab, number>; hrefFor: (tab: CommunityTab) => string }) {
  return (
    <nav aria-label="Discussion views" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border">
      {(Object.keys(TAB_LABELS) as CommunityTab[]).map((tab) => {
        const isActive = tab === active;
        return (
          <Link
            key={tab}
            href={hrefFor(tab)}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              isActive ? "border-accent text-ink" : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
            )}
          >
            {TAB_LABELS[tab]}
            <span className={cn("rounded-full px-1.5 py-px text-[11px] tabular-nums", isActive ? "bg-accent/15 text-accent" : "bg-surface-3 text-ink-muted")}>{counts[tab]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";
import type { PrerequisiteItem } from "@/components/learn/drip-shared";

function StateIcon({ item }: { item: PrerequisiteItem }) {
  if (item.state === "completed") return <Icon.CheckCircleFilled className="size-4.5 shrink-0 text-success" aria-hidden="true" />;
  if (item.state === "in_progress") return <Icon.CircleDot className="size-4.5 shrink-0 text-warning" aria-hidden="true" />;
  return <Icon.Circle className="size-4.5 shrink-0 text-ink-faint" aria-hidden="true" />;
}

/**
 * Prerequisite courses with the viewer's status and links (course page card,
 * locked lesson page). A Client Component usable from Server and Client
 * Components; its labels are `global.` keys because the locked lesson page
 * belongs to another group.
 */
export function PrerequisiteList({ items, className, compact = false }: { items: PrerequisiteItem[]; className?: string; compact?: boolean }) {
  const t = useT("public");
  if (!items.length) return null;
  const stateLabel = (item: PrerequisiteItem): string | null => {
    switch (item.state) {
      case "completed":
        return t("global.prerequisites.completed");
      case "in_progress":
        return t("global.prerequisites.inProgress", { percent: item.progress });
      case "not_started":
        return t("global.prerequisites.notStarted");
      default:
        return null;
    }
  };
  return (
    <ul className={cn("space-y-1.5", className)}>
      {items.map((item) => {
        const label = stateLabel(item);
        return (
          <li key={item.courseId}>
            <Link
              href={`/courses/${item.slug}`}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg border border-border bg-surface-1 transition-colors hover:border-border-strong hover:bg-surface-2",
                compact ? "px-2.5 py-2" : "px-3 py-2.5",
              )}
            >
              <StateIcon item={item} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink group-hover:text-accent">{item.title}</span>
                {label && (
                  <span className={cn("block text-xs", item.state === "completed" ? "text-success" : "text-ink-muted")}>
                    <span className="sr-only">{t("global.prerequisites.status")} </span>
                    {label}
                  </span>
                )}
              </span>
              <Icon.ChevronRight
                className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

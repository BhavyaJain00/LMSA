import type { ReactNode } from "react";
import { Markdown } from "@/lib/markdown";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import type { AnnouncementView } from "./types";

/** Batch announcements, newest first: sender, time ago, subject and markdown body. */
export function AnnouncementList({
  announcements,
  showCc = false,
  actions,
  className,
}: {
  announcements: AnnouncementView[];
  showCc?: boolean;
  actions?: (announcement: AnnouncementView) => ReactNode;
  className?: string;
}) {
  return (
    <ol className={cn("space-y-6", className)}>
      {announcements.map((a) => (
        <li key={a.id} id={`announcement-${a.id}`} className="scroll-mt-24">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={a.author?.name ?? "Instructor"} src={a.author?.avatarUrl} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{a.author?.name ?? "Former instructor"}</p>
                <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)} className="text-xs text-ink-muted" suppressHydrationWarning>
                  {relativeTime(a.createdAt)}
                </time>
              </div>
            </div>
            {actions?.(a)}
          </div>
          <article className="rounded-card border border-border bg-surface-2/60 px-4 py-3">
            <h3 className="text-base font-semibold text-ink">{a.subject}</h3>
            <Markdown content={a.body} className="mt-2 text-sm" />
            {showCc && a.cc && a.cc.length > 0 && <p className="mt-3 border-t border-border pt-2 text-xs text-ink-muted">CC: {a.cc.join(", ")}</p>}
          </article>
        </li>
      ))}
    </ol>
  );
}

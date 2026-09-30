import Link from "next/link";
import { instructorPath } from "@/lib/seo/content-index";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface InstructorLinkData {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  headline?: string;
}

/**
 * Compact row of instructors (avatar, name, headline) linking to their
 * teaching profiles, for category and topic pages. Server Component.
 */
export function InstructorLinks({ instructors, className }: { instructors: InstructorLinkData[]; className?: string }) {
  if (!instructors.length) return null;
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {instructors.map((instructor) => (
        <li key={instructor.id} className="min-w-0">
          <Link
            href={instructorPath(instructor.username)}
            className="flex h-full items-center gap-3 rounded-card border border-border bg-surface-1 p-3 transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Avatar name={instructor.name} src={instructor.avatarUrl} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{instructor.name}</span>
              {instructor.headline && <span className="block truncate text-xs text-ink-muted">{instructor.headline}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

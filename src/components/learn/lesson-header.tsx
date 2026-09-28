import Link from "next/link";
import type { ReactNode } from "react";
import type { PublicUser } from "@/lib/types";
import { Markdown } from "@/lib/markdown";
import { formatDuration } from "@/lib/utils";
import { AvatarGroup, Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";

/** Breadcrumbs: Courses › course › lesson. */
export function LessonBreadcrumbs({ courseTitle, courseHref, lessonTitle, lessonHref }: { courseTitle: string; courseHref: string; lessonTitle: string; lessonHref?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
        <li className="shrink-0">
          <Link href="/courses" className="hover:text-ink">
            Courses
          </Link>
        </li>
        <li aria-hidden="true" className="shrink-0 text-ink-faint">
          <Icon.ChevronRight className="size-3.5" />
        </li>
        <li className="min-w-0 truncate">
          <Link href={courseHref} className="hover:text-ink" title={courseTitle}>
            {courseTitle}
          </Link>
        </li>
        <li aria-hidden="true" className="hidden shrink-0 text-ink-faint sm:block">
          <Icon.ChevronRight className="size-3.5" />
        </li>
        <li className="hidden min-w-0 truncate font-medium text-ink sm:block" aria-current="page">
          {lessonHref ? (
            <Link href={lessonHref} className="hover:underline" title={lessonTitle}>
              {lessonTitle}
            </Link>
          ) : (
            lessonTitle
          )}
        </li>
      </ol>
    </nav>
  );
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/** "Maya Chen" / "Maya and Admin" / "Maya and 2 others" with stacked avatars. */
export function InstructorsRow({ instructors }: { instructors: PublicUser[] }) {
  if (!instructors.length) return null;
  const [first, second] = instructors;
  let text: ReactNode;
  if (instructors.length === 1) {
    text = (
      <Link href={`/user/${first!.username}`} className="font-medium text-ink hover:underline">
        {first!.name}
      </Link>
    );
  } else if (instructors.length === 2) {
    text = (
      <>
        <Link href={`/user/${first!.username}`} className="font-medium text-ink hover:underline">
          {firstName(first!.name)}
        </Link>{" "}
        and{" "}
        <Link href={`/user/${second!.username}`} className="font-medium text-ink hover:underline">
          {firstName(second!.name)}
        </Link>
      </>
    );
  } else {
    text = (
      <>
        <Link href={`/user/${first!.username}`} className="font-medium text-ink hover:underline">
          {firstName(first!.name)}
        </Link>{" "}
        and {instructors.length - 1} others
      </>
    );
  }
  return (
    <div className="flex items-center gap-2.5 text-sm text-ink-muted">
      {instructors.length === 1 ? (
        <Avatar name={first!.name} src={first!.avatarUrl} size="xs" />
      ) : (
        <AvatarGroup users={instructors.map((u) => ({ name: u.name, avatarUrl: u.avatarUrl }))} size="xs" max={3} />
      )}
      <span>
        <span className="sr-only">Instructors: </span>
        {text}
      </span>
    </div>
  );
}

/** Private notes for instructors and moderators only. */
export function InstructorNotesBox({ notes }: { notes: string }) {
  if (!notes.trim()) return null;
  return (
    <section aria-label="Instructor notes" className="rounded-xl border border-dashed border-border-strong bg-surface-2/70 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-muted">
        <Icon.Lock className="size-4" /> Instructor notes
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-muted">Private</span>
      </p>
      <Markdown content={notes} />
    </section>
  );
}

/** Meta line: "Chapter 1 · Lesson 3 of 12 · 10m". */
export function LessonMeta({ chapterNumber, chapterTitle, index, total, durationSeconds, preview }: { chapterNumber: number; chapterTitle: string; index: number; total: number; durationSeconds: number; preview: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
      <span className="font-medium uppercase tracking-wider text-ink-faint">Chapter {chapterNumber}</span>
      <span className="truncate">{chapterTitle}</span>
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">
        Lesson {index + 1} of {total}
      </span>
      {durationSeconds > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <Icon.Clock className="size-3.5" /> {formatDuration(durationSeconds)}
          </span>
        </>
      )}
      {preview && <span className="rounded bg-info/12 px-1.5 py-0.5 font-medium text-info">Free preview</span>}
    </p>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import type { PublicUser } from "@/lib/types";
import { Markdown } from "@/lib/markdown";
import { AvatarGroup, Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getT } from "@/i18n/server";

/** Breadcrumbs: Courses › course › lesson. */
export async function LessonBreadcrumbs({ courseTitle, courseHref, lessonTitle, lessonHref }: { courseTitle: string; courseHref: string; lessonTitle: string; lessonHref?: string }) {
  const [t, shell] = await Promise.all([getT("learning"), getT("shell")]);
  return (
    <nav aria-label={t("learn.breadcrumb")} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
        <li className="shrink-0">
          <Link href="/courses" className="hover:text-ink">
            {shell("nav.courses")}
          </Link>
        </li>
        <li aria-hidden="true" className="shrink-0 text-ink-faint">
          <Icon.ChevronRight className="size-3.5 rtl:rotate-180" />
        </li>
        <li className="min-w-0 truncate">
          <Link href={courseHref} className="hover:text-ink" title={courseTitle}>
            {courseTitle}
          </Link>
        </li>
        <li aria-hidden="true" className="hidden shrink-0 text-ink-faint sm:block">
          <Icon.ChevronRight className="size-3.5 rtl:rotate-180" />
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
export async function InstructorsRow({ instructors }: { instructors: PublicUser[] }) {
  if (!instructors.length) return null;
  const t = await getT("learning");
  const [first, second] = instructors;
  let text: ReactNode;
  if (instructors.length === 1) {
    text = (
      <Link href={`/user/${first!.username}`} className="font-medium text-ink hover:underline">
        {first!.name}
      </Link>
    );
  } else if (instructors.length === 2) {
    text = t.rich("learn.instructors.two", {
      first: firstName(first!.name),
      second: firstName(second!.name),
      a: (chunks) => (
        <Link href={`/user/${first!.username}`} className="font-medium text-ink hover:underline">
          {chunks}
        </Link>
      ),
      b: (chunks) => (
        <Link href={`/user/${second!.username}`} className="font-medium text-ink hover:underline">
          {chunks}
        </Link>
      ),
    });
  } else {
    text = t.rich("learn.instructors.many", {
      first: firstName(first!.name),
      count: instructors.length - 1,
      a: (chunks) => (
        <Link href={`/user/${first!.username}`} className="font-medium text-ink hover:underline">
          {chunks}
        </Link>
      ),
    });
  }
  return (
    <div className="flex items-center gap-2.5 text-sm text-ink-muted">
      {instructors.length === 1 ? (
        <Avatar name={first!.name} src={first!.avatarUrl} size="xs" />
      ) : (
        <AvatarGroup users={instructors.map((u) => ({ name: u.name, avatarUrl: u.avatarUrl }))} size="xs" max={3} />
      )}
      <span>
        <span className="sr-only">{t("learn.instructors.label")} </span>
        {text}
      </span>
    </div>
  );
}

/** Private notes for instructors and moderators only. */
export async function InstructorNotesBox({ notes }: { notes: string }) {
  if (!notes.trim()) return null;
  const t = await getT("learning");
  return (
    <section aria-label={t("learn.instructorNotes")} className="rounded-xl border border-dashed border-border-strong bg-surface-2/70 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-muted">
        <Icon.Lock className="size-4" /> {t("learn.instructorNotes")}
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-muted">{t("learn.private")}</span>
      </p>
      <Markdown content={notes} />
    </section>
  );
}

/** Meta line: "Chapter 1 · Lesson 3 of 12 · 10m". */
export async function LessonMeta({ chapterNumber, chapterTitle, index, total, durationSeconds, preview }: { chapterNumber: number; chapterTitle: string; index: number; total: number; durationSeconds: number; preview: boolean }) {
  const [t, f] = await Promise.all([getT("learning"), getFormatter()]);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
      <span className="font-medium uppercase tracking-wider text-ink-faint">{t("learn.meta.chapter", { number: chapterNumber })}</span>
      <span className="truncate">{chapterTitle}</span>
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">
        {t("learn.meta.position", { index: index + 1, total })}
      </span>
      {durationSeconds > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <Icon.Clock className="size-3.5" /> {f.duration(durationSeconds)}
          </span>
        </>
      )}
      {preview && <span className="rounded bg-info/12 px-1.5 py-0.5 font-medium text-info">{t("learn.freePreview")}</span>}
    </p>
  );
}

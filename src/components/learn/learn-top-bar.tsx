"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PublicUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ProgressRing } from "@/components/ui/progress";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { useLearnPrefs } from "./learn-provider";
import { openCommandPalette } from "@/components/command-palette/events";
import { useShortcutLabel } from "@/components/command-palette/open-button";

export interface LearnTopBarProps {
  brand: { name: string; logoUrl?: string };
  course: { title: string; href: string };
  /** Course progress for enrolled learners (null hides the ring). */
  progress: { percent: number; completed: number; total: number } | null;
  user: PublicUser | null;
  signupEnabled: boolean;
}

/** Slim full-width top bar of the lesson player (replaces the app shell). */
export function LearnTopBar({ brand, course, progress, user, signupEnabled }: LearnTopBarProps) {
  const { zen } = useLearnPrefs();
  const pathname = usePathname();
  const next = encodeURIComponent(pathname || course.href);
  const shortcut = useShortcutLabel();

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface-1/95 px-3 backdrop-blur sm:gap-3 sm:px-4",
        zen && "hidden",
      )}
    >
      <Link href="/" className="flex shrink-0 items-center gap-2 rounded-lg p-1 text-ink hover:bg-surface-2" aria-label={`${brand.name} home`}>
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" className="size-7 rounded-md object-contain" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-fg">{brand.name.slice(0, 1).toUpperCase()}</span>
        )}
        <span className="hidden text-sm font-semibold tracking-tight md:inline">{brand.name}</span>
      </Link>

      <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="hidden text-[11px] font-medium uppercase tracking-wider text-ink-faint sm:block">Course</p>
        <Link href={course.href} className="block truncate text-sm font-semibold text-ink hover:text-accent" title={course.title}>
          {course.title}
        </Link>
      </div>

      {progress && (
        <div
          className="flex shrink-0 items-center gap-2"
          title={`${progress.completed} of ${progress.total} lessons completed`}
          aria-label={`Course progress: ${progress.percent}% (${progress.completed} of ${progress.total} lessons)`}
          role="img"
        >
          <ProgressRing value={progress.percent} size={34} stroke={3} tone={progress.percent >= 100 ? "success" : "accent"}>
            <span className="text-[10px] font-semibold tabular-nums">{progress.percent}%</span>
          </ProgressRing>
          <span className="hidden text-xs leading-tight text-ink-muted lg:block">
            <span className="block font-medium text-ink">{progress.percent >= 100 ? "Completed" : "Your progress"}</span>
            {progress.completed}/{progress.total} lessons
          </span>
        </div>
      )}

      <ButtonLink href={course.href} variant="ghost" size="sm" leftIcon={<Icon.ArrowLeft className="size-4" />} aria-label="Back to course" className="shrink-0">
        <span className="hidden sm:inline">Back to course</span>
      </ButtonLink>

      <button
        type="button"
        onClick={openCommandPalette}
        className="shrink-0 rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
        aria-label="Search"
        title={`Search (${shortcut})`}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Icon.Search className="size-5" />
      </button>

      <ThemeToggle className="shrink-0" />

      {user ? (
        <UserMenu user={user} />
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <ButtonLink href={`/login?next=${next}`} variant="ghost" size="sm">
            Log in
          </ButtonLink>
          {signupEnabled && (
            <ButtonLink href={`/register?next=${next}`} size="sm" className="hidden sm:inline-flex">
              Sign up
            </ButtonLink>
          )}
        </div>
      )}
    </header>
  );
}

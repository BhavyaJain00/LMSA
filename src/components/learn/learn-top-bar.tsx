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
import { BrandMark } from "@/components/layout/brand-mark";
import { useLearnPrefs } from "./learn-provider";
import { openCommandPalette } from "@/components/command-palette/events";
import { useShortcutLabel } from "@/components/command-palette/open-button";
import { useT } from "@/i18n/client";

export interface LearnTopBarProps {
  brand: { name: string; logoUrl?: string };
  course: { title: string; href: string };
  /** Course progress for enrolled learners (null hides the ring). */
  progress: { percent: number; completed: number; total: number } | null;
  user: PublicUser | null;
  signupEnabled: boolean;
}

/**
 * Slim full-width top bar of the lesson player (replaces the app shell). It sits on the page
 * canvas above the two lesson panels: brand, "Back to course", and the account tools. The
 * course title and progress ring are shown only below 1024px, where the sidebar (which has
 * both) is a bottom sheet; phones drop the brand mark to leave room for the course title.
 */
export function LearnTopBar({ brand, course, progress, user, signupEnabled }: LearnTopBarProps) {
  const { zen } = useLearnPrefs();
  const pathname = usePathname();
  const next = encodeURIComponent(pathname || course.href);
  const shortcut = useShortcutLabel();
  const t = useT("learning");
  const shell = useT("shell");

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 shrink-0 items-center gap-1.5 border-b border-border bg-surface/95 px-2 backdrop-blur sm:gap-2 sm:px-4 lg:border-b-0",
        zen && "hidden",
      )}
    >
      <Link href="/" className="hidden shrink-0 items-center gap-2 rounded-lg p-1 text-ink hover:bg-surface-2 sm:flex" aria-label={t("learn.topBar.home", { brand: brand.name })}>
        <BrandMark name={brand.name} logoUrl={brand.logoUrl} size="sm" nameClassName="hidden font-bold md:inline" />
      </Link>

      <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

      <ButtonLink href={course.href} variant="ghost" size="sm" leftIcon={<Icon.ArrowLeft className="size-4 rtl:rotate-180" />} aria-label={t("learn.backToCourse")} className="shrink-0">
        <span className="hidden sm:inline">{t("learn.backToCourse")}</span>
      </ButtonLink>

      <div className="min-w-0 flex-1">
        <Link href={course.href} className="block truncate text-sm font-semibold text-ink hover:text-accent lg:hidden" title={course.title}>
          {course.title}
        </Link>
      </div>

      {progress && (
        <div
          className="flex shrink-0 items-center lg:hidden"
          title={t("learn.topBar.progressTitle", { completed: progress.completed, total: progress.total })}
          aria-label={t("learn.topBar.progressLabel", { percent: progress.percent, completed: progress.completed, total: progress.total })}
          role="img"
        >
          <ProgressRing value={progress.percent} size={32} stroke={3} tone={progress.percent >= 100 ? "success" : "accent"}>
            <span className="text-[10px] font-semibold tabular-nums">{progress.percent}%</span>
          </ProgressRing>
        </div>
      )}

      <button
        type="button"
        onClick={openCommandPalette}
        className="shrink-0 rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
        aria-label={shell("header.search")}
        title={t("learn.topBar.searchShortcut", { shortcut })}
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
            {shell("header.logIn")}
          </ButtonLink>
          {signupEnabled && (
            <ButtonLink href={`/register?next=${next}`} size="sm" className="hidden sm:inline-flex">
              {shell("header.signUp")}
            </ButtonLink>
          )}
        </div>
      )}
    </header>
  );
}

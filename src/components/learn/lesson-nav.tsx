"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon, Spinner } from "@/components/ui/icons";
import { useT } from "@/i18n/client";
import { useLearnPrefs } from "./learn-provider";
import { useLessonRuntime } from "./lesson-runtime";

function useNextLabel(): (locked: boolean) => string {
  const t = useT("learning");
  const common = useT("common");
  return (locked) => (locked ? t("learn.nav.completeAndContinue") : common("actions.next"));
}

/**
 * Compact Previous / Next pair under the lesson title (Next is the page's primary action).
 * On phones the pair spans the width and Next takes the remaining space.
 */
export function LessonNavButtons({ className }: { className?: string }) {
  const rt = useLessonRuntime();
  const t = useT("learning");
  const common = useT("common");
  const nextLabel = useNextLabel();
  const busy = rt.navigating || rt.completing;
  return (
    <div className={cn("flex w-full items-center gap-2 sm:w-auto", className)}>
      {rt.prev && (
        <Button variant="outline" onClick={rt.goPrev} disabled={!rt.canGoPrev || busy} leftIcon={<Icon.ChevronLeft className="size-4 rtl:rotate-180" />}>
          {common("actions.previous")}
        </Button>
      )}
      {rt.canGoNext ? (
        <Button
          onClick={() => void rt.goNext()}
          loading={busy}
          rightIcon={<Icon.ChevronRight className="size-4 rtl:rotate-180" />}
          title={rt.next?.locked ? t("learn.nav.lockedHint") : undefined}
          className="flex-1 sm:flex-none"
        >
          {nextLabel(!!rt.next?.locked)}
        </Button>
      ) : (
        <ButtonLink href={rt.courseHref} variant="outline" className="flex-1 sm:flex-none">
          {t("learn.backToCourse")}
        </ButtonLink>
      )}
    </div>
  );
}

/** Large Previous / Next cards at the end of the lesson. */
export function LessonPager() {
  const rt = useLessonRuntime();
  const t = useT("learning");
  const common = useT("common");
  const nextLabel = useNextLabel();
  const busy = rt.navigating || rt.completing;
  return (
    <nav aria-label={t("learn.nav.label")} className="grid gap-3 sm:grid-cols-2">
      {rt.prev && rt.canGoPrev ? (
        <Link
          href={rt.prev.href}
          className="group flex items-center gap-3 rounded-card border border-border bg-surface-1 p-4 transition-colors hover:bg-surface-2"
        >
          <Icon.ArrowLeft className="size-5 shrink-0 text-ink-faint transition-transform group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5" />
          <span className="min-w-0">
            <span className="block text-meta text-ink-faint">{common("actions.previous")}</span>
            <span className="block truncate text-sm font-medium text-ink">{rt.prev.title}</span>
          </span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {rt.canGoNext && rt.next ? (
        <button
          type="button"
          onClick={() => void rt.goNext()}
          disabled={busy}
          className="group flex items-center justify-end gap-3 rounded-card border border-accent/40 bg-accent/8 p-4 text-end transition-colors hover:bg-accent/12 disabled:opacity-70 sm:col-start-2"
        >
          <span className="min-w-0">
            <span className="block text-meta font-medium text-accent">{nextLabel(rt.next.locked)}</span>
            <span className="block truncate text-sm font-medium text-ink">{rt.next.title}</span>
          </span>
          {busy ? (
            <Spinner className="size-5 shrink-0 text-accent" />
          ) : (
            <Icon.ArrowRight className="size-5 shrink-0 text-accent transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          )}
        </button>
      ) : (
        <Link
          href={rt.courseHref}
          className="group flex items-center justify-end gap-3 rounded-card border border-border bg-surface-1 p-4 text-end transition-colors hover:bg-surface-2 sm:col-start-2"
        >
          <span className="min-w-0">
            <span className="block text-meta text-ink-faint">{rt.next ? t("learn.nav.nextLocked") : t("learn.nav.reachedEnd")}</span>
            <span className="block truncate text-sm font-medium text-ink">{t("learn.backToCourse")}</span>
          </span>
          <Icon.BookOpen className="size-5 shrink-0 text-ink-faint" />
        </Link>
      )}
    </nav>
  );
}

/** Sticky pager bar under the top bar on small screens: ‹ i / n ›. */
export function MobilePager({ index, total }: { index: number; total: number }) {
  const rt = useLessonRuntime();
  const t = useT("learning");
  const { zen } = useLearnPrefs();
  const busy = rt.navigating || rt.completing;
  return (
    <div className={cn("sticky z-30 flex items-center justify-between border-b border-border bg-surface-1/95 px-4 py-2 backdrop-blur lg:hidden", zen ? "top-0" : "top-14")}>
      <button
        type="button"
        onClick={rt.goPrev}
        disabled={!rt.canGoPrev || busy}
        aria-label={t("learn.nav.previousLesson")}
        className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-ink transition-colors hover:bg-surface-3 disabled:opacity-40"
      >
        <Icon.ChevronLeft className="size-5 rtl:rotate-180" />
      </button>
      <span className="text-xs font-medium tabular-nums text-ink-muted" aria-live="polite">
        {t("learn.nav.mobilePosition", { index: index + 1, total })}
      </span>
      {rt.canGoNext ? (
        <button
          type="button"
          onClick={() => void rt.goNext()}
          disabled={busy}
          aria-label={rt.next?.locked ? t("learn.nav.completeAndNext") : t("learn.nextLesson")}
          className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-ink transition-colors hover:bg-surface-3 disabled:opacity-40"
        >
          {busy ? <Spinner className="size-4" /> : <Icon.ChevronRight className="size-5 rtl:rotate-180" />}
        </button>
      ) : (
        <span className="size-9" aria-hidden="true" />
      )}
    </div>
  );
}

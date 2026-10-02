"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

export interface LockedRedirectNoticeProps {
  variant: "locked" | "not_found";
  /** Where to go (the resume lesson); falls back to the course page. */
  href: string | null;
  targetTitle?: string;
  courseHref: string;
  seconds?: number;
}

/**
 * Shown when an enrolled learner opens a lesson that is still locked by
 * sequential completion (or a lesson number that does not exist). Counts down
 * and then takes them to the lesson they should be on.
 */
export function LockedRedirectNotice({ variant, href, targetTitle, courseHref, seconds = 3 }: LockedRedirectNoticeProps) {
  const router = useRouter();
  const t = useT("learning");
  const destination = href ?? courseHref;
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (left === 0) router.replace(destination);
  }, [left, destination, router]);

  const title = variant === "locked" ? t("learn.locked.title") : t("learn.lessonNotFound");
  const description = variant === "locked" ? t("learn.locked.body") : t("learn.notFound.body");
  const announcement = href ? t("learn.redirect.announceLesson", { title, seconds }) : t("learn.redirect.announceCourse", { title, seconds });

  return (
    <div className="mx-auto w-full max-w-(--lesson-w) py-6">
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <div className="flex flex-col gap-3 rounded-xl border border-warning/35 bg-warning/10 p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
          {variant === "locked" ? <Icon.Lock className="size-5" /> : <Icon.Question className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="text-sm text-ink-muted">
            {description}
            {targetTitle && (
              <>
                {" "}
                {t.rich("learn.redirect.current", { title: targetTitle, b: (text) => <span className="font-medium text-ink">{text}</span> })}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs tabular-nums text-ink-muted" aria-hidden="true">
            {t("learn.redirect.secondsShort", { seconds: left })}
          </span>
          <Button variant="outline" size="sm" onClick={() => router.replace(destination)}>
            {t("learn.redirect.goNow")}
          </Button>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-ink-muted">
        <Link href={courseHref} className="font-medium text-accent hover:underline">
          {t("learn.backToCourse")}
        </Link>
      </p>
    </div>
  );
}

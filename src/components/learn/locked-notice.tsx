import { getRequestLockedLesson } from "@/lib/data/lessons";
import type { LockedLessonState } from "./drip-shared";
import { DripLockedCard } from "./drip-locked-card";
import { LockedRedirectNotice } from "./locked-redirect-notice";
import { PrerequisiteLockedCard } from "./prerequisite-locked-card";

export interface LockedLessonNoticeProps {
  variant: "locked" | "not_found";
  /** Where to go (the resume lesson); falls back to the course page. */
  href: string | null;
  targetTitle?: string;
  courseHref: string;
  seconds?: number;
  /**
   * Drip / prerequisite details of the locked lesson (`data.lockState` from
   * `getLessonPageData`). When omitted, the state recorded for this request by
   * `getLessonPageData` is used.
   */
  lock?: LockedLessonState | null;
}

/**
 * Body of the lesson page when the requested lesson cannot be opened:
 *  - scheduled (drip) lessons get a countdown card with the local release time,
 *  - prerequisite locks list the courses to finish first,
 *  - enforced-order locks and unknown lesson numbers redirect to the lesson the
 *    learner should be on after a short countdown.
 */
export function LockedLessonNotice({ variant, href, targetTitle, courseHref, seconds, lock }: LockedLessonNoticeProps) {
  const state = variant === "locked" ? (lock !== undefined ? lock : getRequestLockedLesson()) : null;

  if (state?.lock.reason === "drip" && state.lock.unlocksAt) {
    return (
      <DripLockedCard
        lessonTitle={state.lessonTitle}
        unlocksAt={state.lock.unlocksAt}
        afterPrevious={!!state.lock.afterPrevious}
        courseHref={courseHref}
        resume={href && targetTitle ? { href, title: targetTitle } : null}
      />
    );
  }
  if (state?.lock.reason === "prerequisite") {
    return <PrerequisiteLockedCard lessonTitle={state.lessonTitle} prerequisites={state.prerequisites} courseHref={courseHref} />;
  }
  return <LockedRedirectNotice variant={variant} href={href} targetTitle={targetTitle} courseHref={courseHref} seconds={seconds} />;
}

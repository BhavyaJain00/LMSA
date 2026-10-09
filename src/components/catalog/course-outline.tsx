import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getCourseOutline, type ScheduledChapter } from "@/lib/data/courses";
import { cleanReleaseRule, shortRuleLabel } from "@/components/learn/drip-shared";
import { CourseOutlineAccordion, type ScheduledOutlineChapterView, type ScheduledOutlineLessonView } from "./course-outline-accordion";
import type { OutlineChapterView, OutlineMode } from "./types";

export type { ScheduledOutlineChapterView, ScheduledOutlineLessonView } from "./course-outline-accordion";

/** Earliest drip unlock of a chapter when all of its lessons are still scheduled. */
function chapterUnlocksAt(lessons: ScheduledOutlineLessonView[]): string | null {
  if (!lessons.length) return null;
  let earliest: string | null = null;
  for (const lesson of lessons) {
    const at = lesson.lock?.reason === "drip" ? lesson.lock.unlocksAt : undefined;
    if (!at) return null;
    if (!earliest || Date.parse(at) < Date.parse(earliest)) earliest = at;
  }
  return earliest;
}

/** Merge the viewer's drip locks (and, for managers, the configured rules) into the page's outline view. */
function withSchedule(chapters: OutlineChapterView[], outline: ScheduledChapter[], mode: OutlineMode): ScheduledOutlineChapterView[] {
  const chapterById = new Map(outline.map((c) => [c.id, c]));
  const lessonById = new Map(outline.flatMap((c) => c.lessons).map((l) => [l.id, l]));
  const manager = mode === "manager";
  return chapters.map((chapter) => {
    const source = chapterById.get(chapter.id);
    const lessons: ScheduledOutlineLessonView[] = chapter.lessons.map((lesson) => {
      const scheduled = lessonById.get(lesson.id);
      const lock = lesson.locked ? scheduled?.lock : undefined;
      const rule = manager && scheduled ? cleanReleaseRule(scheduled) : null;
      return {
        ...lesson,
        ...(lock ? { lock } : {}),
        rule,
        ruleLabel: rule ? shortRuleLabel(rule) : null,
      };
    });
    const rule = manager && source ? cleanReleaseRule(source) : null;
    return {
      ...chapter,
      lessons,
      unlocksAt: manager ? null : chapterUnlocksAt(lessons),
      rule,
      ruleLabel: rule ? shortRuleLabel(rule) : null,
    };
  });
}

/**
 * Curriculum on the course page. A Server Component: it resolves the viewer's
 * release schedule (scheduled lessons with their unlock time, and the
 * configured drip rules for course managers) and renders the interactive
 * accordion with it.
 */
export async function CourseOutline({
  chapters,
  mode,
  defaultOpenIds,
  nextLessonId,
  header,
}: {
  chapters: OutlineChapterView[];
  mode: OutlineMode;
  /** Chapters expanded on first render (defaults to the first one). */
  defaultOpenIds?: string[];
  /** Lesson highlighted as "Up next" for enrolled learners. */
  nextLessonId?: string | null;
  /** Section title laid out next to the "Expand all" toggle. */
  header?: ReactNode;
}) {
  let scheduled: ScheduledOutlineChapterView[] = chapters;
  const firstChapterId = chapters[0]?.id;
  if (firstChapterId) {
    const db = await getDb();
    const courseId = db.chapters.find((c) => c.id === firstChapterId)?.courseId;
    const course = courseId ? db.courses.find((c) => c.id === courseId) : undefined;
    if (course) {
      const viewer = await getCurrentUser();
      scheduled = withSchedule(chapters, await getCourseOutline(course, viewer), mode);
    }
  }
  return <CourseOutlineAccordion chapters={scheduled} mode={mode} defaultOpenIds={defaultOpenIds} nextLessonId={nextLessonId} header={header} />;
}

import "server-only";
import type { Course, Database, Transcript, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { computeViewerLessons, lessonHref } from "@/lib/data/courses";
import { foldText, snippetAround } from "./cues";
import { findVideoBlock } from "./data";

/**
 * Search across lesson video transcripts.
 *
 * `searchTranscripts(query, viewer)` returns only lessons the viewer can
 * open (same locking rules as the lesson page: enrollment, free previews,
 * drip schedule, enforced order, scheduled publishing), each with the
 * matching lines, their timestamps and a link that starts the video there
 * (`?t=<seconds>`). Matching ignores case and accents; folded cue text is
 * cached per transcript version.
 */

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

export interface TranscriptMatch {
  /** Seconds from the start of the video. */
  start: number;
  /** Excerpt of the cue around the match. */
  snippet: string;
  /** Character ranges of the match inside `snippet` (for highlighting). */
  ranges: [number, number][];
}

export interface TranscriptSearchResult {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  blockId: string;
  /** Lesson link starting the video at the first match. */
  href: string;
  matches: TranscriptMatch[];
  totalMatches: number;
}

export interface TranscriptSearchOptions {
  /** Most lessons returned (default 20). */
  limit?: number;
  /** Most matching lines per lesson (default 3). */
  matchesPerLesson?: number;
  /** Search one course only. */
  courseId?: string;
}

/* ------------------------------------------------------------------ */
/* Pure core                                                            */
/* ------------------------------------------------------------------ */

export interface SearchableTranscript {
  key: string;
  /** Folded text of each cue (see `foldText`), in cue order. */
  folded: readonly string[];
}

/** Normalized query or null when too short. */
export function normalizeQuery(query: string): string | null {
  const q = foldText(query.trim().slice(0, MAX_QUERY_LENGTH)).replace(/\s+/g, " ");
  return q.length >= MIN_QUERY_LENGTH ? q : null;
}

/**
 * Matching cues of each transcript, best first: more matches first, then
 * the original order. `folded` must hold the folded text of each cue.
 */
export function rankTranscriptHits(
  transcripts: readonly SearchableTranscript[],
  query: string,
  opts: { limit: number; matchesPerLesson: number },
): { key: string; indices: number[]; total: number }[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const hits: { key: string; indices: number[]; total: number; order: number }[] = [];
  transcripts.forEach((t, order) => {
    const indices: number[] = [];
    let total = 0;
    t.folded.forEach((text, i) => {
      if (!text.includes(q)) return;
      total++;
      if (indices.length < opts.matchesPerLesson) indices.push(i);
    });
    if (total) hits.push({ key: t.key, indices, total, order });
  });
  hits.sort((a, b) => b.total - a.total || a.order - b.order);
  return hits.slice(0, opts.limit).map(({ key, indices, total }) => ({ key, indices, total }));
}

/* ------------------------------------------------------------------ */
/* Folded text cache                                                    */
/* ------------------------------------------------------------------ */

const FOLD_CACHE_MAX = 2000;
const g = globalThis as unknown as { __llTranscriptFold?: Map<string, { stamp: string; folded: string[] }> };
const foldCache = (g.__llTranscriptFold ??= new Map());

function foldedCues(t: Transcript): string[] {
  const hit = foldCache.get(t.id);
  if (hit && hit.stamp === t.updatedAt) return hit.folded;
  const folded = t.cues.map((c) => foldText(c.text.replace(/\s+/g, " ")));
  foldCache.delete(t.id);
  foldCache.set(t.id, { stamp: t.updatedAt, folded });
  if (foldCache.size > FOLD_CACHE_MAX) foldCache.delete(foldCache.keys().next().value!);
  return folded;
}

/* ------------------------------------------------------------------ */
/* Access-aware search                                                  */
/* ------------------------------------------------------------------ */

interface OpenLesson {
  lessonTitle: string;
  href: string;
  course: Course;
}

/** Lessons of `course` the viewer can open, keyed by id. */
function openLessons(db: Database, course: Course, viewer: User | null, now: number): Map<string, OpenLesson> {
  const out = new Map<string, OpenLesson>();
  const { state, lessons } = computeViewerLessons(db, course, viewer, now);
  const courseVisible = course.published || state.manager || state.enrolled;
  if (!courseVisible) return out;
  for (const row of lessons) {
    if (row.lock) continue;
    if (!state.manager && row.lesson.publishAt && Date.parse(row.lesson.publishAt) > now) continue;
    out.set(row.lesson.id, {
      lessonTitle: row.lesson.title,
      href: lessonHref(course.slug, { chapterNumber: row.ci + 1, lessonNumber: row.li + 1 }),
      course,
    });
  }
  return out;
}

export async function searchTranscripts(query: string, viewer: User | null, opts: TranscriptSearchOptions = {}): Promise<TranscriptSearchResult[]> {
  if (!normalizeQuery(query)) return [];
  const limit = Math.min(Math.max(1, opts.limit ?? 20), 50);
  const matchesPerLesson = Math.min(Math.max(1, opts.matchesPerLesson ?? 3), 10);
  const db = await getDb();
  const now = Date.now();

  const lessonsById = new Map(db.lessons.map((l) => [l.id, l]));
  const coursesById = new Map(db.courses.map((c) => [c.id, c]));
  const accessByCourse = new Map<string, Map<string, OpenLesson>>();

  const candidates: { t: Transcript; open: OpenLesson }[] = [];
  for (const t of db.transcripts) {
    if (!t.cues.length || t.status === "failed") continue;
    const lesson = lessonsById.get(t.lessonId);
    // Only the transcript the block currently points at (never one of a replaced video).
    if (!lesson || findVideoBlock(lesson, t.blockId)?.transcriptId !== t.id) continue;
    if (opts.courseId && lesson.courseId !== opts.courseId) continue;
    const course = coursesById.get(lesson.courseId);
    if (!course) continue;
    let open = accessByCourse.get(course.id);
    if (!open) {
      open = openLessons(db, course, viewer, now);
      accessByCourse.set(course.id, open);
    }
    const entry = open.get(lesson.id);
    if (entry) candidates.push({ t, open: entry });
  }

  const byKey = new Map(candidates.map((c) => [c.t.id, c]));
  const ranked = rankTranscriptHits(
    candidates.map(({ t }) => ({ key: t.id, folded: foldedCues(t) })),
    query,
    { limit, matchesPerLesson },
  );

  return ranked.map(({ key, indices, total }) => {
    const { t, open } = byKey.get(key)!;
    const matches = indices.map((i) => {
      const cue = t.cues[i]!;
      const snippet = snippetAround(cue.text, query);
      return { start: cue.start, snippet: snippet.text, ranges: snippet.ranges };
    });
    const first = Math.floor(matches[0]?.start ?? 0);
    return {
      courseId: open.course.id,
      courseTitle: open.course.title,
      lessonId: t.lessonId,
      lessonTitle: open.lessonTitle,
      blockId: t.blockId,
      href: `${open.href}?t=${first}`,
      matches,
      totalMatches: total,
    };
  });
}

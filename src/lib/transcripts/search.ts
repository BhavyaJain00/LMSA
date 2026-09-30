import "server-only";
import type { Course, Lesson, Transcript, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { getLearnContext } from "@/lib/data/lessons";
import { foldText, snippetAround } from "./cues";
import { findVideoBlock } from "./data";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, lessonTimeHref } from "./panel";

/**
 * Search across lesson video transcripts.
 *
 * `searchTranscripts(query, viewer)` returns only lessons the viewer can
 * open, decided by the same rules as the lesson page and the video itself
 * (`getLearnContext`: enrollment, memberships that lapsed, free previews,
 * drip schedule, enforced order) plus scheduled publishing. Each result
 * carries the matching lines, their timestamps and links that start the
 * video there (`?t=<seconds>`). Matching ignores case and accents and also
 * finds a phrase that runs from one caption into the next; folded cue text
 * is cached per transcript version.
 *
 * The text is matched first and access is resolved only for the courses of
 * lessons that matched, best results first, until enough are found.
 */

export { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH };

export interface TranscriptMatch {
  /** Seconds from the start of the video. */
  start: number;
  /** Excerpt of the caption around the match. */
  snippet: string;
  /** Character ranges of the match inside `snippet` (for highlighting). */
  ranges: [number, number][];
  /** Lesson link starting the video at this line. */
  href: string;
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
  /** Most lessons returned (default 20, at most 50). */
  limit?: number;
  /** Most matching lines per lesson (default 3, at most 10). */
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

export interface TranscriptHit {
  /** Cue the match starts in. */
  index: number;
  /** The phrase continues into the next cue. */
  spans: boolean;
}

/** Normalized query or null when too short. */
export function normalizeQuery(query: string): string | null {
  const q = foldText(query.trim().slice(0, MAX_QUERY_LENGTH)).replace(/\s+/g, " ").trim();
  return q.length >= MIN_QUERY_LENGTH ? q : null;
}

/**
 * Cues matching the normalized query `q`, in order. Captions are short, so a
 * phrase of several words is also looked for across the boundary between a
 * cue and the next one ("…the loop" + "variable is…").
 */
export function findTranscriptHits(folded: readonly string[], q: string): TranscriptHit[] {
  const hits: TranscriptHit[] = [];
  const phrase = q.includes(" ");
  for (let i = 0; i < folded.length; i++) {
    const text = folded[i]!;
    if (text.includes(q)) {
      hits.push({ index: i, spans: false });
      continue;
    }
    const next = phrase ? folded[i + 1] : undefined;
    if (!next || !text) continue;
    // `text` alone has no match, so one that starts inside it runs on into `next`.
    const at = `${text} ${next}`.indexOf(q, Math.max(0, text.length - q.length + 1));
    if (at >= 0 && at < text.length) hits.push({ index: i, spans: true });
  }
  return hits;
}

/**
 * Transcripts containing `query`, best first: more matching lines first,
 * then the given order. Each keeps its first `matchesPerLesson` hits.
 */
export function rankTranscriptHits(
  transcripts: readonly SearchableTranscript[],
  query: string,
  opts: { matchesPerLesson: number; limit?: number },
): { key: string; hits: TranscriptHit[]; total: number }[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const ranked: { key: string; hits: TranscriptHit[]; total: number; order: number }[] = [];
  transcripts.forEach((t, order) => {
    const hits = findTranscriptHits(t.folded, q);
    if (hits.length) ranked.push({ key: t.key, hits: hits.slice(0, opts.matchesPerLesson), total: hits.length, order });
  });
  ranked.sort((a, b) => b.total - a.total || a.order - b.order);
  return ranked.slice(0, opts.limit ?? ranked.length).map(({ key, hits, total }) => ({ key, hits, total }));
}

/* ------------------------------------------------------------------ */
/* Folded text cache                                                    */
/* ------------------------------------------------------------------ */

const FOLD_CACHE_MAX = 2000;
const g = globalThis as unknown as { __llTranscriptFold?: Map<string, { stamp: string; folded: string[] }> };
const foldCache = (g.__llTranscriptFold ??= new Map());

function foldedCues(t: Transcript): string[] {
  const hit = foldCache.get(t.id);
  if (hit && hit.stamp === t.updatedAt && hit.folded.length === t.cues.length) return hit.folded;
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
  title: string;
  href: string;
}

/**
 * Lessons of `course` the viewer can open right now, keyed by id: the rule
 * of `getLessonAccess` (`canView`, or a course manager), so search never
 * shows words from a video the viewer could not play.
 */
async function openLessons(course: Course, viewer: User | null, now: number): Promise<Map<string, OpenLesson>> {
  const out = new Map<string, OpenLesson>();
  const ctx = await getLearnContext(course, viewer, { notify: false, now });
  if (!course.published && !ctx.manager && !ctx.enrolled) return out;
  for (const lesson of ctx.flat) {
    if (lesson.locked) continue;
    if (!ctx.manager && lesson.publishAt && Date.parse(lesson.publishAt) > now) continue;
    out.set(lesson.id, { title: lesson.title, href: lesson.href });
  }
  return out;
}

export async function searchTranscripts(query: string, viewer: User | null, opts: TranscriptSearchOptions = {}): Promise<TranscriptSearchResult[]> {
  if (!normalizeQuery(query)) return [];
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 20)), 50);
  const matchesPerLesson = Math.min(Math.max(1, Math.floor(opts.matchesPerLesson ?? 3)), 10);
  const db = await getDb();
  const now = Date.now();

  const coursesById = new Map(db.courses.map((c) => [c.id, c]));
  const lessonsById = new Map(db.lessons.map((l) => [l.id, l]));
  const enrolledIn = new Set(viewer ? db.enrollments.filter((e) => e.userId === viewer.id).map((e) => e.courseId) : []);
  const manages = new Map<string, boolean>();
  const mayManage = (course: Course) => {
    let value = manages.get(course.id);
    if (value === undefined) manages.set(course.id, (value = canManageCourse(viewer, course)));
    return value;
  };

  const candidates = new Map<string, { t: Transcript; lesson: Lesson; course: Course }>();
  for (const t of db.transcripts) {
    if (!t.cues.length || t.status === "failed") continue;
    const lesson = lessonsById.get(t.lessonId);
    // Only the transcript the block currently points at (never one of a replaced video).
    if (!lesson || findVideoBlock(lesson, t.blockId)?.transcriptId !== t.id) continue;
    if (opts.courseId && lesson.courseId !== opts.courseId) continue;
    const course = coursesById.get(lesson.courseId);
    if (!course) continue;
    // Without an enrollment only free previews can be open: skip the rest before reading any text.
    if (!lesson.includeInPreview && !enrolledIn.has(course.id) && !mayManage(course)) continue;
    candidates.set(t.id, { t, lesson, course });
  }

  const ranked = rankTranscriptHits(
    [...candidates.values()].map(({ t }) => ({ key: t.id, folded: foldedCues(t) })),
    query,
    { matchesPerLesson },
  );

  const openByCourse = new Map<string, Map<string, OpenLesson>>();
  const results: TranscriptSearchResult[] = [];
  for (const { key, hits, total } of ranked) {
    if (results.length >= limit) break;
    const { t, lesson, course } = candidates.get(key)!;
    let open = openByCourse.get(course.id);
    if (!open) {
      open = await openLessons(course, viewer, now);
      openByCourse.set(course.id, open);
    }
    const entry = open.get(lesson.id);
    if (!entry) continue;

    // `?t=` targets the lesson's first video; any other one is named.
    const firstVideoId = lesson.blocks.find((b) => b.type === "video")?.id;
    const target = t.blockId === firstVideoId ? null : t.blockId;
    const matches = hits.map(({ index, spans }): TranscriptMatch => {
      const cue = t.cues[index]!;
      const text = spans && t.cues[index + 1] ? `${cue.text} ${t.cues[index + 1]!.text}` : cue.text;
      const snippet = snippetAround(text, query);
      return { start: cue.start, snippet: snippet.text, ranges: snippet.ranges, href: lessonTimeHref(entry.href, cue.start, target) };
    });
    results.push({
      courseId: course.id,
      courseTitle: course.title,
      lessonId: lesson.id,
      lessonTitle: entry.title,
      blockId: t.blockId,
      href: matches[0]!.href,
      matches,
      totalMatches: total,
    });
  }
  return results;
}

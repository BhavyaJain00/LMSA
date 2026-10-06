import "server-only";
import { createHash } from "node:crypto";
import type { Course, Database, User } from "@/lib/types";
import { computeViewerLessons } from "@/lib/data/courses";
import { buildBm25Index, searchBm25, type Bm25Index } from "./bm25";
import { chunkCourseSources, collectCourseSources, describeChunk, type CourseChunk, type CourseSource } from "./sources";
import { estimateTokens, truncateToTokens } from "./text";

/**
 * Per-course retrieval index for the AI tutor.
 *
 * The raw course material is collected from the database on every lookup
 * (cheap: no chunking) and hashed; chunking and the BM25 index are redone
 * only when that content hash changes. Editing a lesson, a transcript, a quiz
 * explanation or the outline, or adding an instructor clarification, is
 * therefore picked up on the next question without any explicit
 * invalidation. Indexes live on `globalThis` (bounded LRU) so dev hot
 * reloads keep them.
 */

/** Bump when chunking or source selection changes so cached indexes are rebuilt. */
const INDEX_VERSION = 3;
const MAX_CACHED_COURSES = 100;

export interface CachedIndex {
  hash: string;
  index: Bm25Index<CourseChunk>;
  builtAt: number;
}

const g = globalThis as unknown as { __llAiCourseIndex?: Map<string, CachedIndex> };
const cache: Map<string, CachedIndex> = (g.__llAiCourseIndex ??= new Map());

/** Content hash of a course's collected sources (changes whenever anything the tutor reads changes). */
export function sourcesHash(sources: CourseSource[]): string {
  const h = createHash("sha256");
  h.update(`v${INDEX_VERSION}\u0002`);
  for (const s of sources) {
    h.update(`${s.kind}\u0000${s.lessonId}\u0000${s.lessonTitle}\u0000${s.title}\u0000${s.trusted ? 1 : 0}\u0000${s.text}\u0000`);
    for (const cue of s.cues ?? []) h.update(`${cue.start}\u0003${cue.end}\u0003${cue.text}\u0004`);
    h.update("\u0001");
  }
  return h.digest("hex");
}

/** The course's BM25 index, rebuilt when its content hash changed. */
export function getCourseIndex(db: Database, courseId: string): CachedIndex {
  const sources = collectCourseSources(db, courseId);
  const hash = sourcesHash(sources);
  const cached = cache.get(courseId);
  if (cached && cached.hash === hash) {
    // Refresh LRU position.
    cache.delete(courseId);
    cache.set(courseId, cached);
    return cached;
  }
  const entry: CachedIndex = { hash, index: buildBm25Index(chunkCourseSources(sources)), builtAt: Date.now() };
  cache.delete(courseId);
  cache.set(courseId, entry);
  while (cache.size > MAX_CACHED_COURSES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  return entry;
}

/**
 * Lessons whose material the viewer may see: course managers see everything;
 * learners only lessons that are open to them (drip, order and scheduled
 * publishing respected), so the tutor never leaks content that is still locked.
 */
export function readableLessonIds(db: Database, course: Course, viewer: Pick<User, "id" | "roles"> | null, now: number = Date.now()): Set<string> | null {
  const { state, lessons } = computeViewerLessons(db, course, viewer, now);
  if (state.manager) return null;
  const ids = new Set<string>();
  for (const row of lessons) {
    if (row.lock) continue;
    if (row.lesson.publishAt && Date.parse(row.lesson.publishAt) > now) continue;
    ids.add(row.lesson.id);
  }
  return ids;
}

export interface RetrievedExcerpt {
  chunk: CourseChunk;
  score: number;
  /** Label shown to the model and on citation chips. */
  label: string;
  /** Text sent to the model (trimmed to the excerpt budget). */
  text: string;
}

export interface RetrieveOptions {
  k?: number;
  /** Total token budget for all excerpts. */
  budgetTokens?: number;
  currentLessonId?: string | null;
}

/** Default number of excerpts sent with a question. */
export const DEFAULT_TOP_K = 6;
/** Default token budget for all excerpts of one question. */
export const DEFAULT_EXCERPT_BUDGET = 3500;

/**
 * Keep ranked excerpts within a token budget (pure). The last one that fits
 * partially is cut at a sentence boundary; fragments under ~120 tokens are
 * not worth sending.
 */
export function fitExcerpts(hits: { doc: CourseChunk; score: number }[], budgetTokens: number): RetrievedExcerpt[] {
  const out: RetrievedExcerpt[] = [];
  let used = 0;
  for (const hit of hits) {
    const remaining = budgetTokens - used;
    if (remaining < 120) break;
    const text = estimateTokens(hit.doc.text) > remaining ? truncateToTokens(hit.doc.text, remaining) : hit.doc.text;
    used += estimateTokens(text);
    out.push({ chunk: hit.doc, score: hit.score, label: describeChunk(hit.doc), text });
  }
  return out;
}

/** Top excerpts for a question, restricted to what the viewer may read. */
export function retrieveExcerpts(db: Database, course: Course, viewer: Pick<User, "id" | "roles"> | null, query: string, options: RetrieveOptions = {}): RetrievedExcerpt[] {
  const { index } = getCourseIndex(db, course.id);
  const allowed = readableLessonIds(db, course, viewer);
  const currentLessonId = options.currentLessonId && (!allowed || allowed.has(options.currentLessonId)) ? options.currentLessonId : null;
  const hits = searchBm25(index, query, { k: options.k ?? DEFAULT_TOP_K, currentLessonId, allowedLessonIds: allowed, fillFromCurrentLesson: true });
  return fitExcerpts(hits, options.budgetTokens ?? DEFAULT_EXCERPT_BUDGET);
}

/** Index statistics for the admin screens. */
export function courseIndexStats(db: Database, courseId: string): { chunks: number; lessons: number; transcripts: number; clarifications: number } {
  const { index } = getCourseIndex(db, courseId);
  const lessons = new Set<string>();
  let transcripts = 0;
  let clarifications = 0;
  for (const chunk of index.docs) {
    if (chunk.lessonId) lessons.add(chunk.lessonId);
    if (chunk.kind === "transcript") transcripts++;
    if (chunk.kind === "clarification") clarifications++;
  }
  return { chunks: index.docs.length, lessons: lessons.size, transcripts, clarifications };
}

import { refersToCurrentLesson, tokenize } from "./text";

/**
 * Hand-written Okapi BM25 ranking for the AI tutor's course index, with:
 *  - a title boost (query terms found in the chunk title add extra weight),
 *  - a current-lesson boost (the learner is usually asking about what is on screen),
 *  - a trusted boost (instructor clarifications win close calls),
 *  - a per-lesson cap so one long lesson can't crowd out everything else,
 *  - an optional top-up from the current lesson for "summarise this lesson"
 *    style questions and for questions that match nothing.
 *
 * Pure: unit tested in tests/ai-tutor-bm25.test.ts.
 */

export interface Bm25Doc {
  id: string;
  lessonId: string;
  title: string;
  text: string;
  trusted?: boolean;
  order?: number;
}

interface IndexedDoc {
  tf: Map<string, number>;
  length: number;
  titleTerms: Set<string>;
}

export interface Bm25Index<D extends Bm25Doc = Bm25Doc> {
  docs: D[];
  indexed: IndexedDoc[];
  /** Number of documents containing each term (body or title). */
  df: Map<string, number>;
  avgLength: number;
}

export interface Bm25Options {
  /** Term-frequency saturation. */
  k1: number;
  /** Length normalisation. */
  b: number;
  /** Weight of a query term that appears in the title, relative to its idf. */
  titleBoost: number;
  /** Score multiplier for chunks of the lesson the learner is on. */
  currentLessonBoost: number;
  /** Score multiplier for trusted chunks. */
  trustedBoost: number;
}

export const DEFAULT_BM25_OPTIONS: Bm25Options = { k1: 1.2, b: 0.75, titleBoost: 1.5, currentLessonBoost: 1.35, trustedBoost: 1.25 };

export function buildBm25Index<D extends Bm25Doc>(docs: D[]): Bm25Index<D> {
  const df = new Map<string, number>();
  const indexed: IndexedDoc[] = docs.map((doc) => {
    const terms = tokenize(doc.text);
    const tf = new Map<string, number>();
    for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
    const titleTerms = new Set(tokenize(doc.title));
    for (const term of new Set([...tf.keys(), ...titleTerms])) df.set(term, (df.get(term) ?? 0) + 1);
    return { tf, length: terms.length, titleTerms };
  });
  const total = indexed.reduce((s, d) => s + d.length, 0);
  return { docs, indexed, df, avgLength: indexed.length ? total / indexed.length : 0 };
}

export interface SearchOptions {
  /** Maximum results. */
  k?: number;
  /** Chunks of this lesson get `currentLessonBoost`. */
  currentLessonId?: string | null;
  /** When set, only chunks whose lessonId is in the set (or "" for course-level chunks) are considered. */
  allowedLessonIds?: ReadonlySet<string> | null;
  /** At most this many results from one lesson (default 3). */
  maxPerLesson?: number;
  /**
   * Top up the results with the opening passages of the current lesson (in
   * outline order, up to `maxPerLesson` from it, score 0) when the question is
   * about "this lesson" or nothing matched: a summary request or a question
   * typed in another language shares few words with the material.
   */
  fillFromCurrentLesson?: boolean;
  weights?: Partial<Bm25Options>;
}

export interface SearchHit<D extends Bm25Doc = Bm25Doc> {
  doc: D;
  score: number;
}

/** Inverse document frequency (BM25+ style, never negative). */
function idf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export function searchBm25<D extends Bm25Doc>(index: Bm25Index<D>, query: string, options: SearchOptions = {}): SearchHit<D>[] {
  const w = { ...DEFAULT_BM25_OPTIONS, ...(options.weights ?? {}) };
  const k = Math.max(1, options.k ?? 6);
  const maxPerLesson = Math.max(1, options.maxPerLesson ?? 3);
  const queryTerms = new Map<string, number>();
  for (const term of tokenize(query)) queryTerms.set(term, (queryTerms.get(term) ?? 0) + 1);
  if (!index.docs.length) return [];

  const n = index.docs.length;
  const avg = index.avgLength || 1;
  const hits: SearchHit<D>[] = [];
  index.docs.forEach((doc, i) => {
    if (options.allowedLessonIds && doc.lessonId && !options.allowedLessonIds.has(doc.lessonId)) return;
    const d = index.indexed[i]!;
    let score = 0;
    for (const [term, qtf] of queryTerms) {
      const docFreq = index.df.get(term);
      if (!docFreq) continue;
      const weight = idf(n, docFreq);
      const tf = d.tf.get(term) ?? 0;
      if (tf) score += weight * ((tf * (w.k1 + 1)) / (tf + w.k1 * (1 - w.b + (w.b * d.length) / avg))) * Math.min(qtf, 3);
      if (d.titleTerms.has(term)) score += weight * w.titleBoost;
    }
    if (score <= 0) return;
    if (options.currentLessonId && doc.lessonId === options.currentLessonId) score *= w.currentLessonBoost;
    if (doc.trusted) score *= w.trustedBoost;
    hits.push({ doc, score });
  });

  hits.sort((a, b) => b.score - a.score || (a.doc.order ?? 0) - (b.doc.order ?? 0));
  const perLesson = new Map<string, number>();
  const out: SearchHit<D>[] = [];
  for (const hit of hits) {
    const key = hit.doc.lessonId || "__course";
    const used = perLesson.get(key) ?? 0;
    if (used >= maxPerLesson) continue;
    perLesson.set(key, used + 1);
    out.push(hit);
    if (out.length >= k) break;
  }

  const current = options.currentLessonId;
  const wantsLesson = out.length === 0 || refersToCurrentLesson(query);
  if (options.fillFromCurrentLesson && current && wantsLesson && out.length < k && (!options.allowedLessonIds || options.allowedLessonIds.has(current))) {
    const taken = new Set(out.map((h) => h.doc.id));
    const lessonDocs = index.docs.filter((d) => d.lessonId === current && !taken.has(d.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const doc of lessonDocs) {
      if (out.length >= k || (perLesson.get(current) ?? 0) >= maxPerLesson) break;
      perLesson.set(current, (perLesson.get(current) ?? 0) + 1);
      out.push({ doc, score: 0 });
    }
  }
  return out;
}

import { tokenize } from "./text";

/**
 * Groups similar learner questions for the "Top questions" list in the AI
 * usage dashboard ("what is a closure?", "What's a closure" and "closures —
 * what are they" land together).
 *
 * Questions are normalised to their set of meaningful, stemmed terms and
 * greedily assigned to the first cluster whose terms overlap enough
 * (Jaccard similarity). Pure: unit tested in tests/ai-tutor-cluster.test.ts.
 */

export interface QuestionItem {
  id: string;
  text: string;
  lessonId?: string;
  courseId?: string;
}

export interface QuestionCluster {
  /** The clearest wording in the group (shortest of the most common forms). */
  label: string;
  count: number;
  ids: string[];
  /** Up to five distinct wordings. */
  examples: string[];
  lessonIds: string[];
  courseIds: string[];
}

/** Sorted unique meaningful terms of a question. */
export function questionKey(text: string): string[] {
  return [...new Set(tokenize(text))].sort();
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 1;
  const setB = new Set(b);
  let shared = 0;
  for (const t of new Set(a)) if (setB.has(t)) shared++;
  return shared / (new Set([...a, ...b]).size || 1);
}

function displayForm(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clusterQuestions(items: QuestionItem[], options: { threshold?: number; limit?: number } = {}): QuestionCluster[] {
  const threshold = options.threshold ?? 0.5;
  const clusters: { key: string[]; members: QuestionItem[]; forms: Map<string, number> }[] = [];
  for (const item of items) {
    const key = questionKey(item.text);
    if (!key.length) continue;
    let best: (typeof clusters)[number] | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = jaccard(key, cluster.key);
      if (score >= threshold && score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    const form = displayForm(item.text);
    if (best) {
      best.members.push(item);
      best.forms.set(form, (best.forms.get(form) ?? 0) + 1);
    } else {
      clusters.push({ key, members: [item], forms: new Map([[form, 1]]) });
    }
  }
  const out = clusters.map((c): QuestionCluster => {
    const forms = [...c.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
    return {
      label: forms[0]![0],
      count: c.members.length,
      ids: c.members.map((m) => m.id),
      examples: forms.slice(0, 5).map(([f]) => f),
      lessonIds: [...new Set(c.members.map((m) => m.lessonId).filter((id): id is string => !!id))],
      courseIds: [...new Set(c.members.map((m) => m.courseId).filter((id): id is string => !!id))],
    };
  });
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return options.limit ? out.slice(0, options.limit) : out;
}

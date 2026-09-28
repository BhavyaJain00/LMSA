/**
 * Pure formatting helpers shared by the catalog components (server and client).
 */

/** 950 -> "950", 1234 -> "1.2k", 1500000 -> "1.5M" (Frappe's card number format). */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.round(n || 0)));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Enrolled-count label used in "This course includes": exact under 50,
 * floored to the nearest 50 under 1000, else the nearest 100, with a "+".
 */
export function enrolledTier(n: number): string {
  if (n < 50) return String(n);
  if (n < 1000) return `${Math.floor(n / 50) * 50}+`;
  return `${Math.floor(n / 100) * 100}+`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "3 sections · 12 lessons" (parts omitted when 0). */
export function outlineStats(chapters: number, lessons: number): string {
  const parts: string[] = [];
  if (chapters > 0) parts.push(`${chapters} ${plural(chapters, "section")}`);
  if (lessons > 0) parts.push(`${lessons} ${plural(lessons, "lesson")}`);
  return parts.join(" · ");
}

export type LessonKind = "video" | "quiz" | "assignment" | "exercise" | "text";

export const lessonKindLabels: Record<LessonKind, string> = {
  video: "Video",
  quiz: "Quiz",
  assignment: "Assignment",
  exercise: "Programming exercise",
  text: "Reading",
};

/** Kind of a lesson = its first meaningful block (mirrors Frappe's lesson icon rule). */
export function lessonKindFromBlocks(blocks: { type: string }[]): LessonKind {
  for (const b of blocks) {
    if (b.type === "video") return "video";
    if (b.type === "quiz") return "quiz";
    if (b.type === "assignment") return "assignment";
    if (b.type === "exercise") return "exercise";
  }
  return "text";
}

/** Relative day label used on reviews: "Today", "3 days ago", "2 months ago", "1 year ago". */
export function reviewDateLabel(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return "Today";
  if (days < 30) return `${days} ${plural(days, "day")} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${plural(months, "month")} ago`;
  const years = Math.floor(days / 365);
  return `${Math.max(1, years)} ${plural(Math.max(1, years), "year")} ago`;
}

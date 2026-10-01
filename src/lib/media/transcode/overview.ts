import type { Database, TranscodeJob } from "@/lib/types";

/**
 * Pure helpers for the conversion queue table in Settings → Storage & video:
 * status filter, search by lesson/course title, newest first, pagination.
 */

export const QUEUE_FILTERS = ["all", "queued", "running", "failed", "done"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export const QUEUE_PAGE_SIZE = 20;

export function parseQueueFilter(raw: string | string[] | undefined): QueueFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (QUEUE_FILTERS as readonly string[]).includes(value ?? "") ? (value as QueueFilter) : "all";
}

export function parsePage(raw: string | string[] | undefined): number {
  const n = Number.parseInt((Array.isArray(raw) ? raw[0] : raw) ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1;
}

export interface QueueRow {
  job: TranscodeJob;
  lessonTitle: string | null;
  courseTitle: string | null;
  courseId: string | null;
  /** Lesson editor link (null when the lesson was deleted). */
  editHref: string | null;
}

export interface QueuePage {
  rows: QueueRow[];
  total: number;
  page: number;
  pages: number;
  /** Jobs per status before the filter and search (for the filter chips). */
  counts: Record<QueueFilter, number>;
}

/** Running first, then queued in queue order, then the rest newest first. */
function compareJobs(a: TranscodeJob, b: TranscodeJob): number {
  const rank = (j: TranscodeJob) => (j.status === "running" ? 0 : j.status === "queued" ? 1 : 2);
  const r = rank(a) - rank(b);
  if (r) return r;
  if (a.status === "queued") return a.createdAt.localeCompare(b.createdAt);
  return (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt);
}

export function queuePage(
  db: Pick<Database, "transcodeJobs" | "lessons" | "courses">,
  opts: { filter: QueueFilter; query?: string; page?: number; pageSize?: number },
): QueuePage {
  const lessons = new Map(db.lessons.map((l) => [l.id, l]));
  const courses = new Map(db.courses.map((c) => [c.id, c]));
  const counts: Record<QueueFilter, number> = { all: db.transcodeJobs.length, queued: 0, running: 0, failed: 0, done: 0 };
  for (const job of db.transcodeJobs) counts[job.status]++;

  const needle = (opts.query ?? "").trim().toLowerCase();
  const rows: QueueRow[] = [];
  for (const job of db.transcodeJobs) {
    if (opts.filter !== "all" && job.status !== opts.filter) continue;
    const lesson = lessons.get(job.lessonId);
    const course = lesson ? courses.get(lesson.courseId) : undefined;
    if (needle) {
      const hay = `${lesson?.title ?? ""} ${course?.title ?? ""} ${job.sourceKey}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    rows.push({
      job,
      lessonTitle: lesson?.title ?? null,
      courseTitle: course?.title ?? null,
      courseId: course?.id ?? null,
      editHref: lesson && course ? `/admin/courses/${course.id}/lessons/${lesson.id}` : null,
    });
  }
  rows.sort((a, b) => compareJobs(a.job, b.job));

  const pageSize = Math.max(1, opts.pageSize ?? QUEUE_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pages, counts };
}

/** First line of a job error (the message; the ffmpeg stderr tail follows it), short enough for a table cell. */
export function errorSummary(error: string | undefined, max = 140): string {
  const line =
    (error ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

import { clusterQuestions, type QuestionCluster } from "./cluster";

/**
 * AI tutor usage dashboard numbers (pure; unit tested in
 * tests/ai-tutor-usage.test.ts): messages per day, tokens, feedback, the most
 * asked questions and "I don't know" rates per lesson — lessons where the
 * tutor often can't answer point at gaps in the course material.
 */

export interface UsageRow {
  conversationId: string;
  courseId: string;
  lessonId?: string;
  learnerId?: string;
  question: string;
  createdAt: string;
  helpful?: boolean;
  flagged: boolean;
  unknown: boolean;
  tokensIn: number;
  tokensOut: number;
  id: string;
}

export interface DailyUsage {
  /** YYYY-MM-DD (UTC) */
  date: string;
  answers: number;
  tokensIn: number;
  tokensOut: number;
}

export interface LessonGap {
  lessonId: string;
  answers: number;
  unknown: number;
  /** 0-100 */
  rate: number;
}

export interface CourseUsage {
  courseId: string;
  answers: number;
  learners: number;
  unknown: number;
  flagged: number;
  tokensIn: number;
  tokensOut: number;
}

export interface UsageSummary {
  answers: number;
  conversations: number;
  learners: number;
  tokensIn: number;
  tokensOut: number;
  helpful: number;
  unhelpful: number;
  flagged: number;
  unknown: number;
  daily: DailyUsage[];
  topQuestions: QuestionCluster[];
  gaps: LessonGap[];
  courses: CourseUsage[];
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Every UTC day from `days - 1` days ago to today, oldest first. */
export function dayRange(days: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) out.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export function summarizeUsage(rows: UsageRow[], options: { days?: number; now?: Date; minGapAnswers?: number } = {}): UsageSummary {
  const days = Math.max(1, options.days ?? 30);
  const range = dayRange(days, options.now);
  const since = range[0]!;
  const inRange = rows.filter((r) => dayKey(r.createdAt) >= since);

  const daily = new Map(range.map((date) => [date, { date, answers: 0, tokensIn: 0, tokensOut: 0 }]));
  const conversations = new Set<string>();
  const learners = new Set<string>();
  const perLesson = new Map<string, { answers: number; unknown: number }>();
  const perCourse = new Map<string, CourseUsage & { learnerIds: Set<string> }>();
  const summary = { answers: 0, tokensIn: 0, tokensOut: 0, helpful: 0, unhelpful: 0, flagged: 0, unknown: 0 };

  for (const row of inRange) {
    const day = daily.get(dayKey(row.createdAt));
    if (day) {
      day.answers++;
      day.tokensIn += row.tokensIn;
      day.tokensOut += row.tokensOut;
    }
    summary.answers++;
    summary.tokensIn += row.tokensIn;
    summary.tokensOut += row.tokensOut;
    if (row.helpful === true) summary.helpful++;
    if (row.helpful === false) summary.unhelpful++;
    if (row.flagged) summary.flagged++;
    if (row.unknown) summary.unknown++;
    conversations.add(row.conversationId);
    if (row.learnerId) learners.add(row.learnerId);
    const course = perCourse.get(row.courseId) ?? { courseId: row.courseId, answers: 0, learners: 0, unknown: 0, flagged: 0, tokensIn: 0, tokensOut: 0, learnerIds: new Set<string>() };
    course.answers++;
    course.tokensIn += row.tokensIn;
    course.tokensOut += row.tokensOut;
    if (row.unknown) course.unknown++;
    if (row.flagged) course.flagged++;
    if (row.learnerId) course.learnerIds.add(row.learnerId);
    perCourse.set(row.courseId, course);
    if (row.lessonId) {
      const entry = perLesson.get(row.lessonId) ?? { answers: 0, unknown: 0 };
      entry.answers++;
      if (row.unknown) entry.unknown++;
      perLesson.set(row.lessonId, entry);
    }
  }

  const minAnswers = options.minGapAnswers ?? 1;
  const gaps = [...perLesson.entries()]
    .filter(([, v]) => v.unknown > 0 && v.answers >= minAnswers)
    .map(([lessonId, v]) => ({ lessonId, answers: v.answers, unknown: v.unknown, rate: Math.round((v.unknown / v.answers) * 100) }))
    .sort((a, b) => b.rate - a.rate || b.unknown - a.unknown);

  const topQuestions = clusterQuestions(
    inRange.slice(0, 2000).map((r) => ({ id: r.id, text: r.question, lessonId: r.lessonId, courseId: r.courseId })),
    { limit: 15 },
  );

  const courses = [...perCourse.values()]
    .map(({ learnerIds, ...c }) => ({ ...c, learners: learnerIds.size }))
    .sort((a, b) => b.answers - a.answers);

  return { ...summary, conversations: conversations.size, learners: learners.size, daily: [...daily.values()], topQuestions, gaps, courses };
}

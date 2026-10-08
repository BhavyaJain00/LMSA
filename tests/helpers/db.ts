/**
 * Database fixtures for tests that go through the real store
 * (`src/lib/db/store.ts`). `tests/register.mjs` points the store at a fresh
 * in-memory database per test process (`helpers/memory-driver.ts`), so
 * tests can freely replace its contents with `resetDb()`.
 */
import type {
  Batch,
  Chapter,
  Coupon,
  Course,
  Database,
  Enrollment,
  Lesson,
  LessonProgress,
  Payment,
  Question,
  Quiz,
  QuizSubmission,
  Settings,
  User,
} from "@/lib/types";
import { COLLECTIONS, flush, getDb, mutate } from "@/lib/db/store";
import { defaultSettings } from "@/lib/db/defaults";
import { currentTestDatabase } from "./memory-driver";

type GroupPatch<T> = T extends unknown[] ? T : T extends object ? Partial<T> : T;

/** Settings overrides: each group is merged over the defaults (`gamification.points` too). */
export type SettingsPatch = { [K in Exclude<keyof Settings, "gamification">]?: GroupPatch<Settings[K]> } & {
  gamification?: Partial<Omit<Settings["gamification"], "points">> & { points?: Partial<Settings["gamification"]["points"]> };
};

export type Fixture = { [K in Exclude<keyof Database, "settings">]?: Database[K] } & { settings?: SettingsPatch };

export function buildSettings(patch: SettingsPatch = {}): Settings {
  const base = defaultSettings();
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = (base as unknown as Record<string, unknown>)[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      out[key] = { ...current, ...value };
    } else {
      out[key] = value;
    }
  }
  const settings = out as unknown as Settings;
  settings.gamification = {
    ...base.gamification,
    ...(patch.gamification ?? {}),
    points: { ...base.gamification.points, ...(patch.gamification?.points ?? {}) },
  };
  return settings;
}

/**
 * Replace the whole database with `fixture` (missing collections become
 * empty, settings are the defaults plus `fixture.settings`). Also resets the
 * per-process caches that depend on the database contents.
 */
export async function resetDb(fixture: Fixture = {}): Promise<Database> {
  const copy = structuredClone(fixture) as Fixture;
  await mutate((db) => {
    const target = db as unknown as Record<string, unknown>;
    for (const name of COLLECTIONS) target[name] = copy[name] ?? [];
    db.settings = buildSettings(copy.settings);
  });
  const points = (globalThis as unknown as { __llPointsBackfill?: { emptyCheckedAt: number } }).__llPointsBackfill;
  if (points) points.emptyCheckedAt = 0;
  return getDb();
}

/** Write pending changes to the test database (call before inspecting it with `storedText()` or ending a suite). */
export async function flushDb(): Promise<void> {
  await flush();
}

/** Everything the store has written to the test database, as text (every stored document and the settings). */
export function storedText(): string {
  const { database } = currentTestDatabase();
  const parts: string[] = [];
  for (const table of database.tables.values()) parts.push(...table.values());
  if (database.settings) parts.push(database.settings);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(++counter).toString(36).padStart(4, "0")}`;

export const FIXED_NOW = "2026-01-15T12:00:00.000Z";

export function makeUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? nextId("usr");
  return {
    id,
    username: id.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
    name: `User ${id}`,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: "scrypt$16384$00$00",
    roles: ["student"],
    enabled: true,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeCourse(overrides: Partial<Course> = {}): Course {
  const id = overrides.id ?? nextId("crs");
  return {
    id,
    slug: id.replace(/_/g, "-"),
    title: `Course ${id}`,
    shortIntroduction: "A course used in tests.",
    description: "",
    cardGradient: "blue",
    instructorIds: [],
    tags: [],
    price: 0,
    currency: "USD",
    paidCourse: false,
    paidCertificate: false,
    certificatePrice: 0,
    enableCertification: false,
    published: true,
    upcoming: false,
    featured: false,
    disableSelfLearning: false,
    enforceLessonCompletion: false,
    status: "approved",
    relatedCourseIds: [],
    outcomes: [],
    requirements: [],
    createdById: "usr_admin",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeChapter(overrides: Partial<Chapter> & Pick<Chapter, "courseId">): Chapter {
  return { id: nextId("chp"), title: "Chapter", order: 1, ...overrides };
}

export function makeLesson(overrides: Partial<Lesson> & Pick<Lesson, "courseId" | "chapterId">): Lesson {
  const id = overrides.id ?? nextId("les");
  return {
    id,
    slug: id.replace(/_/g, "-"),
    title: `Lesson ${id}`,
    order: 1,
    blocks: [{ id: `${id}_md`, type: "markdown", content: "Reading material." }],
    includeInPreview: false,
    durationSeconds: 60,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeEnrollment(overrides: Partial<Enrollment> & Pick<Enrollment, "userId" | "courseId">): Enrollment {
  return { id: nextId("enr"), memberType: "student", enrolledAt: FIXED_NOW, progress: 0, purchasedCertificate: false, ...overrides };
}

export function makeProgress(lesson: Pick<Lesson, "id" | "courseId" | "chapterId">, userId: string, overrides: Partial<LessonProgress> = {}): LessonProgress {
  return {
    id: nextId("prg"),
    userId,
    courseId: lesson.courseId,
    chapterId: lesson.chapterId,
    lessonId: lesson.id,
    status: "complete",
    dwellSeconds: 120,
    completedAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  const id = overrides.id ?? nextId("qst");
  return {
    id,
    text: `Question ${id}`,
    type: "choices",
    multiple: false,
    marks: 1,
    options: [],
    possibilities: [],
    authorId: "usr_admin",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeQuiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: nextId("quiz"),
    title: "Quiz",
    questions: [],
    maxAttempts: 0,
    showAnswers: true,
    showSubmissionHistory: true,
    passingPercentage: 50,
    totalMarks: 0,
    shuffleQuestions: false,
    limitQuestionsTo: 0,
    durationSeconds: 0,
    enableNegativeMarking: false,
    marksToCut: 0,
    enableScheduling: false,
    enableProctoring: false,
    maxViolations: 0,
    authorId: "usr_admin",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeQuizSubmission(overrides: Partial<QuizSubmission> & Pick<QuizSubmission, "quizId" | "userId">): QuizSubmission {
  return {
    id: nextId("qsub"),
    quizTitle: "Quiz",
    results: [],
    score: 1,
    scoreOutOf: 1,
    percentage: 100,
    passingPercentage: 50,
    passed: true,
    violationCount: 0,
    timeTakenSeconds: 30,
    pendingGrading: false,
    submittedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makePayment(overrides: Partial<Payment> & Pick<Payment, "userId" | "itemId">): Payment {
  const id = overrides.id ?? nextId("pay");
  return {
    id,
    orderId: `ORD-${id.toUpperCase()}`,
    itemType: "course",
    itemTitle: "Course",
    originalAmount: 10000,
    discountAmount: 0,
    taxAmount: 0,
    amount: 10000,
    currency: "USD",
    billingName: "Ada Lovelace",
    gateway: "stripe",
    status: "pending",
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  const id = overrides.id ?? nextId("cpn");
  return {
    id,
    code: `SAVE${counter}`,
    discountType: "percentage",
    value: 10,
    usageLimit: 0,
    redemptionCount: 0,
    enabled: true,
    applicableItems: [],
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeBatch(overrides: Partial<Batch> = {}): Batch {
  const id = overrides.id ?? nextId("bat");
  return {
    id,
    slug: id.replace(/_/g, "-"),
    title: `Batch ${id}`,
    description: "",
    details: "",
    startDate: "2026-02-01",
    endDate: "2026-03-01",
    startTime: "09:00",
    endTime: "11:00",
    timezone: "UTC",
    medium: "online",
    seatCount: 0,
    paidBatch: false,
    amount: 0,
    currency: "USD",
    published: true,
    allowSelfEnrollment: true,
    allowFuture: true,
    showLiveClass: true,
    certification: false,
    instructorIds: [],
    courseIds: [],
    assessments: [],
    timetable: [],
    timetableLegends: [],
    createdById: "usr_admin",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

/**
 * A course with chapters and lessons in order. `layout[c]` lists the lesson
 * overrides of chapter `c` (use `{}` for a plain lesson); `chapters[c]`
 * optionally overrides chapter fields such as `dripDays`.
 */
export function makeCourseTree(
  layout: Partial<Lesson>[][],
  options: { course?: Partial<Course>; chapters?: Partial<Chapter>[] } = {},
): { course: Course; chapters: Chapter[]; lessons: Lesson[] } {
  const course = makeCourse(options.course);
  const chapters: Chapter[] = [];
  const lessons: Lesson[] = [];
  layout.forEach((lessonOverrides, ci) => {
    const chapter = makeChapter({ courseId: course.id, order: ci + 1, title: `Chapter ${ci + 1}`, ...(options.chapters?.[ci] ?? {}) });
    chapters.push(chapter);
    lessonOverrides.forEach((overrides, li) => {
      lessons.push(makeLesson({ courseId: course.id, chapterId: chapter.id, order: li + 1, title: `Lesson ${ci + 1}.${li + 1}`, ...overrides }));
    });
  });
  return { course, chapters, lessons };
}

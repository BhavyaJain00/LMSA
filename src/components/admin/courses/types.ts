/**
 * View-model types shared between the admin course pages (server) and the
 * client components that render them. This file has no runtime imports so it
 * can be used from Server Components, Client Components and Server Actions.
 */
import type {
  Announcement,
  Assignment,
  CardGradient,
  Category,
  Chapter,
  Course,
  CourseStatus,
  Lesson,
  LessonBlockType,
  MemberType,
  ProgrammingExercise,
  PublicUser,
  Question,
  Quiz,
  Review,
} from "@/lib/types";

/* ------------------------------ Permissions ------------------------------ */

/** What the current viewer may do with a course in the review/publish workflow. */
export interface WorkflowFlags {
  canEdit: boolean;
  isModerator: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
  canSubmitForReview: boolean;
  canApprove: boolean;
  canRequestChanges: boolean;
  canDelete: boolean;
}

/* ------------------------------ Course list ------------------------------ */

export type AdminCourseTab = "all" | "published" | "unpublished" | "under_review" | "mine";

export interface AdminCourseRow {
  id: string;
  slug: string;
  title: string;
  shortIntroduction: string;
  imageUrl?: string;
  cardGradient: CardGradient;
  published: boolean;
  upcoming: boolean;
  featured: boolean;
  paidCourse: boolean;
  price: number;
  currency: string;
  status: CourseStatus;
  category: string | null;
  instructors: PublicUser[];
  chapterCount: number;
  lessonCount: number;
  enrollmentCount: number;
  updatedAt: string;
  /** Scheduled publish time (ISO), when the course is set to go live later. */
  publishAt?: string;
  workflow: WorkflowFlags;
}

export interface AdminCourseList {
  rows: AdminCourseRow[];
  counts: Record<AdminCourseTab, number>;
}

/* --------------------------------- Outline -------------------------------- */

export interface OutlineLesson extends Omit<Lesson, "blocks" | "instructorNotes"> {
  chapterNumber: number;
  lessonNumber: number;
  /** Distinct block types in order of first appearance (content icons). */
  blockTypes: LessonBlockType[];
  blockCount: number;
  learnHref: string;
  editHref: string;
}

export interface OutlineChapter extends Chapter {
  lessons: OutlineLesson[];
  durationSeconds: number;
}

/* --------------------------------- Pickers -------------------------------- */

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
  avatar?: { name: string; src?: string | null };
}

export interface AssessmentOption {
  id: string;
  title: string;
  courseId?: string;
  courseTitle?: string;
  /** Extra info such as "5 questions" or "Python". */
  meta?: string;
}

export interface AssessmentOptions {
  quizzes: AssessmentOption[];
  assignments: AssessmentOption[];
  exercises: AssessmentOption[];
}

export type AssessmentKind = "quiz" | "assignment" | "exercise";

/* -------------------------------- Dashboard ------------------------------- */

export interface DashboardStudent {
  user: PublicUser;
  enrollmentId: string;
  memberType: MemberType;
  enrolledAt: string;
  /** Pre-formatted on the server so client rendering is timezone-stable. */
  enrolledLabel: string;
  completedAt?: string;
  progress: number;
  lastActivityAt: string | null;
  lastActivityLabel: string | null;
  certificateCode: string | null;
  batchId?: string;
}

export interface LessonCompletionStat {
  lessonId: string;
  /** "<chapter>.<lesson>" */
  index: string;
  order: number;
  title: string;
  completionCount: number;
  percent: number;
}

export interface ProgressBucket {
  key: "just_started" | "in_progress" | "advanced" | "completed";
  label: string;
  range: string;
  count: number;
  percent: number;
  /** 0-1 intensity of the sequential ramp (low progress = faint, completed = full). */
  intensity: number;
}

export interface CourseDashboardData {
  enrollmentCount: number;
  completedCount: number;
  completionRate: number;
  averageProgress: number;
  revenue: number;
  currency: string;
  paidOrders: number;
  averageRating: number | null;
  reviewCount: number;
  lessonCount: number;
  students: DashboardStudent[];
  lessonCompletion: LessonCompletionStat[];
  buckets: ProgressBucket[];
  reviews: (Review & { user: PublicUser | null })[];
}

export interface StudentLessonProgress {
  lessonId: string;
  index: string;
  title: string;
  status: "complete" | "partial" | "incomplete";
  completedAt?: string;
}

export interface StudentChapterProgress {
  chapterId: string;
  title: string;
  lessons: StudentLessonProgress[];
}

export interface StudentAssessmentRow {
  id: string;
  title: string;
  status: string;
  tone: "success" | "danger" | "warning" | "neutral";
}

export interface StudentQuizRow {
  quizId: string;
  title: string;
  score: number;
  scoreOutOf: number;
  percentage: number;
  passed: boolean;
  attempted: boolean;
}

export interface StudentProgressDetail {
  user: PublicUser;
  memberType: MemberType;
  progress: number;
  enrolledAt: string;
  enrolledLabel: string;
  completedAt?: string;
  completedLabel?: string;
  certificateCode: string | null;
  chapters: StudentChapterProgress[];
  quizzes: StudentQuizRow[];
  assignments: StudentAssessmentRow[];
  exercises: StudentAssessmentRow[];
}

/** A user row returned by the "Enroll a student" search. */
export interface EnrollCandidate {
  user: PublicUser;
  enrolled: boolean;
  payments: { id: string; orderId: string; amount: number; currency: string; itemType: string; createdAt: string }[];
}

/* ------------------------------ Announcements ----------------------------- */

export interface AnnouncementRow extends Announcement {
  author: PublicUser | null;
  recipientCount: number;
}

/* ---------------------------------- Forms --------------------------------- */

export interface CourseFormOptions {
  categories: Category[];
  instructors: PublicUser[];
  evaluators: PublicUser[];
  relatedCourses: Pick<Course, "id" | "title" | "slug" | "published">[];
  takenSlugs: string[];
}

/** The editable subset of a course rendered by the details form. */
export type CourseFormValues = Pick<
  Course,
  | "title"
  | "slug"
  | "shortIntroduction"
  | "description"
  | "imageUrl"
  | "videoUrl"
  | "cardGradient"
  | "categoryId"
  | "tags"
  | "instructorIds"
  | "evaluatorId"
  | "outcomes"
  | "requirements"
  | "relatedCourseIds"
>;

export type CourseSettingsValues = Pick<
  Course,
  | "published"
  | "featured"
  | "upcoming"
  | "disableSelfLearning"
  | "enforceLessonCompletion"
  | "paidCourse"
  | "price"
  | "currency"
  | "enableCertification"
  | "paidCertificate"
  | "certificatePrice"
  | "evaluatorId"
  | "metaDescription"
  | "metaKeywords"
>;

/* ------------------------------ Lesson editor ----------------------------- */

export interface LessonEditorNavItem {
  id: string;
  title: string;
  index: string;
  editHref: string;
}

export interface LessonEditorNavChapter {
  id: string;
  title: string;
  lessons: LessonEditorNavItem[];
}

export interface VideoWatchRow {
  user: PublicUser;
  watchSeconds: number;
  maxPositionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: string;
}

export interface VideoStat {
  blockId: string;
  title: string;
  src: string;
  duration: number;
  averageWatchSeconds: number;
  completionRate: number;
  rows: VideoWatchRow[];
}

/* --------------------------------- Export --------------------------------- */

export interface CourseExportFile {
  format: "learnloop-course";
  version: 1;
  exportedAt: string;
  course: Course;
  chapters: Chapter[];
  lessons: Lesson[];
  quizzes: Quiz[];
  questions: Question[];
  assignments: Assignment[];
  exercises: ProgrammingExercise[];
}

export interface CourseExportSummary {
  chapters: number;
  lessons: number;
  blocks: number;
  quizzes: number;
  questions: number;
  assignments: number;
  exercises: number;
  uploads: number;
}

/**
 * View-model types shared between the batch pages (server) and the client
 * components that render them. Keep this file free of runtime imports.
 */
import type {
  Announcement,
  AssessmentType,
  BatchFeedback,
  BatchSummary,
  CardGradient,
  DiscussionReply,
  DiscussionTopic,
  LiveClass,
  PublicUser,
  TimetableItemType,
} from "@/lib/types";

export type BatchStatus = BatchSummary["status"];

export type BatchListTab = "upcoming" | "live" | "archived" | "enrolled" | "unpublished";

export type BatchDetailTab =
  | "overview"
  | "courses"
  | "assessments"
  | "classes"
  | "announcements"
  | "discussions"
  | "timetable"
  | "feedback";

export type AdminBatchTab =
  | "dashboard"
  | "students"
  | "courses"
  | "assessments"
  | "classes"
  | "announcements"
  | "emails"
  | "timetable"
  | "settings";

export interface Option {
  value: string;
  label: string;
  hint?: string;
  group?: string;
}

/** A batch course as shown to visitors and learners. */
export interface BatchCourseItem {
  id: string;
  slug: string;
  title: string;
  shortIntroduction: string;
  imageUrl?: string;
  cardGradient: CardGradient;
  published: boolean;
  lessonCount: number;
  instructors: PublicUser[];
  enrolled: boolean;
  progress: number | null;
  completed: boolean;
  /** First incomplete lesson for "Continue" (only when enrolled). */
  continueHref: string | null;
  nextLessonTitle?: string;
}

export type AssessmentStatus = "not_attempted" | "pass" | "fail" | "not_graded" | "submitted" | "pending";

export interface AssessmentRow {
  /** BatchAssessment id. */
  id: string;
  type: AssessmentType;
  refId: string;
  title: string;
  href: string;
  /** The referenced quiz/assignment/exercise no longer exists. */
  missing: boolean;
  status: AssessmentStatus;
  statusLabel: string;
  /** Best quiz percentage. */
  percentage?: number;
  submittedAt?: string;
  courseTitle?: string;
}

export interface LiveClassView extends LiveClass {
  host: PublicUser | null;
  /** Absolute start/end (epoch ms). */
  startsAt: number;
  endsAt: number;
  endTime: string;
  attended?: boolean;
}

export interface AnnouncementView extends Announcement {
  author: PublicUser | null;
}

export interface ReplyView extends DiscussionReply {
  author: PublicUser | null;
}

export interface DiscussionThread extends DiscussionTopic {
  author: PublicUser | null;
  replies: ReplyView[];
}

export interface TimetableEntry {
  id: string;
  /** Timetable item id (absent for merged live classes). */
  itemId?: string;
  type: TimetableItemType;
  refId?: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  milestone: boolean;
  legendId?: string;
  color: string | null;
  legendLabel?: string;
  href: string | null;
  completed?: boolean;
  source: "timetable" | "live_class";
}

export interface FeedbackView extends BatchFeedback {
  user: PublicUser | null;
}

export interface FeedbackAverages {
  count: number;
  content: number | null;
  instructors: number | null;
  value: number | null;
  overall: number | null;
}

export interface StudentCourseProgress {
  courseId: string;
  title: string;
  slug: string;
  enrolled: boolean;
  progress: number;
}

export interface StudentProgressRow {
  enrollmentId: string;
  userId: string;
  user: PublicUser;
  enrolledAt: string;
  source?: string;
  paymentId?: string;
  lastActiveAt?: string;
  courses: StudentCourseProgress[];
  assessments: AssessmentRow[];
  averageCourseProgress: number;
  passedAssessments: number;
  /** Weighted average of course progress and passed assessments (0-100). */
  overallProgress: number;
  completedCourses: number;
}

export interface ChartDatum {
  /** Course / quiz / assignment / exercise id. */
  refId: string;
  label: string;
  value: number;
  kind: "course" | "quiz" | "assignment" | "exercise";
}

export interface EmailTemplateView {
  id: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: string;
}

export interface AdminBatchRow {
  id: string;
  slug: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: BatchStatus;
  published: boolean;
  studentCount: number;
  seatCount: number;
  seatsLeft: number | null;
  paidBatch: boolean;
  amount: number;
  currency: string;
  instructors: PublicUser[];
  courseCount: number;
}

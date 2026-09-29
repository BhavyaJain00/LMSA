/**
 * View-model types for program pages. Keep free of runtime imports so it can
 * be shared by server pages and client components.
 */
import type { CardGradient, Program, PublicUser } from "@/lib/types";

export type ProgramListTab = "published" | "enrolled";
export type AdminProgramTab = "published" | "unpublished";

export interface ProgramSummary extends Program {
  courseCount: number;
  memberCount: number;
  /** Viewer membership. */
  isMember: boolean;
  /** Viewer progress 0-100 (members only). */
  progress: number | null;
  courseTitles: string[];
}

export interface ProgramCourseView {
  id: string;
  slug: string;
  title: string;
  shortIntroduction: string;
  imageUrl?: string;
  cardGradient: CardGradient;
  published: boolean;
  lessonCount: number;
  enrollmentCount: number;
  instructors: PublicUser[];
  /** 1-based position in the program. */
  position: number;
  enrolled: boolean;
  progress: number | null;
  completed: boolean;
  /** Whether the viewer may open this course (enforced order). */
  eligible: boolean;
  continueHref: string | null;
  /**
   * Whether the viewer can start this course from the program: "open", or
   * blocked because the course is unpublished or needs a payment first.
   */
  access: "open" | "unpublished" | "payment";
}

export interface ProgramMemberView {
  id: string;
  userId: string;
  user: PublicUser;
  progress: number;
  joinedAt: string;
  courses: { courseId: string; title: string; progress: number; enrolled: boolean }[];
  completedCourses: number;
}

export interface AdminProgramCourse {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  lessonCount: number;
}

/**
 * A paid course that a manager's program change (adding a member or a course,
 * lifting the course order) could enroll members in.
 */
export interface ProgramPaidCourse {
  id: string;
  title: string;
  /**
   * The viewer may enroll members who haven't bought it without payment
   * ("Grant access without payment"): they manage the course, like the
   * people who can enroll learners from its admin page.
   */
  grantable: boolean;
}

/** Options of a manager's program change that enrolls members in courses. */
export interface ProgramEnrollOptions {
  /**
   * Enroll members in paid courses they haven't bought (only honoured for
   * courses the manager manages). Off by default: those members are skipped
   * and need to purchase the course first.
   */
  grantPaidAccess?: boolean;
}

/** What a manager's program change did about enrolling members in the program's courses. */
export interface ProgramEnrollmentReport {
  /** Member/course pairs enrolled now. */
  enrolled: number;
  /** Of those, enrollments in paid courses granted without payment. */
  granted: number;
  /** Paid courses members were not enrolled in because they haven't bought them. */
  needsPurchase: { courseId: string; title: string; members: number }[];
  /** Member/course pairs waiting for the member to complete the course's prerequisites. */
  waitingOnPrerequisites: number;
}

/** "3 members need to purchase React Mastery" */
export function needsPurchaseText(item: { title: string; members: number }): string {
  return `${item.members === 1 ? "1 member needs" : `${item.members} members need`} to purchase ${item.title}`;
}

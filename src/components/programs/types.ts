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

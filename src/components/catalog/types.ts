import type { ProgressStatus } from "@/lib/types";
import type { LessonKind } from "./format";

/**
 * Slim, client-safe view models passed from the course page (server) to the
 * interactive catalog components. They never include lesson bodies,
 * instructor notes or user e-mail addresses.
 */

export interface OutlineLessonView {
  id: string;
  title: string;
  chapterNumber: number;
  lessonNumber: number;
  kind: LessonKind;
  durationSeconds: number;
  /** Free preview lesson (open to everyone). */
  preview: boolean;
  locked: boolean;
  status: ProgressStatus;
  /** Learn URL, or null when the viewer cannot open the lesson. */
  href: string | null;
}

export interface OutlineChapterView {
  id: string;
  title: string;
  description?: string;
  number: number;
  durationSeconds: number;
  completedCount: number;
  lessons: OutlineLessonView[];
}

export type OutlineMode = "guest" | "visitor" | "enrolled" | "manager";

export interface ReviewAuthorView {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
}

export interface ReviewView {
  id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  review: string;
  createdAt: string;
  /** Pre-computed relative label ("Today", "3 days ago"). */
  dateLabel: string;
  author: ReviewAuthorView;
  isOwn: boolean;
}

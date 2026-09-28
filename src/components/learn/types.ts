import type { NoteColor, ProgressStatus } from "@/lib/types";

/**
 * Client-safe view models for the learning experience. These never carry
 * lesson content, instructor notes or password hashes, so they can be passed
 * from Server Components to Client Components freely.
 */

/** What kind of lesson this is (first matching block wins, in document order). */
export type LessonKind = "video" | "quiz" | "assignment" | "exercise" | "text";

/** Why a lesson is not accessible to the viewer. */
export type LockReason = "sequential" | "enroll";

export interface OutlineLessonItem {
  id: string;
  title: string;
  href: string;
  chapterNumber: number;
  lessonNumber: number;
  status: ProgressStatus;
  locked: boolean;
  lockReason?: LockReason;
  durationSeconds: number;
  kind: LessonKind;
  preview: boolean;
}

export interface OutlineChapterItem {
  id: string;
  number: number;
  title: string;
  lessons: OutlineLessonItem[];
}

export interface LessonNeighbor {
  id: string;
  title: string;
  href: string;
  status: ProgressStatus;
  locked: boolean;
  lockReason?: LockReason;
  chapterNumber: number;
  lessonNumber: number;
}

export interface UserChip {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
}

export interface NoteItem {
  id: string;
  color: NoteColor;
  note: string;
  highlightedText?: string;
  timestampSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReplyItem {
  id: string;
  topicId: string;
  author: UserChip | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  /** Author is one of the course instructors. */
  isInstructor: boolean;
  /** Viewer wrote this reply. */
  isOwn: boolean;
}

export interface TopicItem {
  id: string;
  title: string;
  author: UserChip | null;
  createdAt: string;
  updatedAt: string;
  isOwn: boolean;
  /** Chronological; the first reply is the question body. */
  replies: ReplyItem[];
}

export type SidebarTab = "outline" | "notes" | "discussion";

export interface CourseProgressInfo {
  completed: number;
  total: number;
  percent: number;
}

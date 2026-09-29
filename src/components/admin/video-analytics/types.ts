/**
 * View models for the video analytics screens (course page, lesson editor
 * statistics dialog). Built on the server by `src/lib/media/analytics.ts`;
 * safe to send to the browser (no secrets, minimal user fields).
 */

export interface AnalyticsUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl?: string;
}

export interface VideoLearnerRow {
  user: AnalyticsUser;
  /** Share of the video watched at least once (0-100). */
  percentWatched: number;
  watchSeconds: number;
  lastPositionSeconds: number;
  maxPositionSeconds: number;
  completed: boolean;
  /** Average viewing passes over the parts watched (1 = watched once). */
  replayFactor: number;
  updatedAt: string;
  /** No retention bins yet: percentages come from the furthest point reached. */
  estimated: boolean;
}

export interface DropOffPoint {
  bin: number;
  time: number;
  from: number;
  to: number;
  drop: number;
}

export interface RewatchPoint {
  bin: number;
  time: number;
  passesPerViewer: number;
}

export interface VideoAnalytics {
  /** `${lessonId}:${blockId}` */
  key: string;
  lessonId: string;
  blockId: string;
  title: string;
  lessonTitle: string;
  chapterTitle: string;
  /** e.g. "2.3" */
  position: string;
  learnHref: string;
  editorHref: string;
  duration: number;
  viewers: number;
  completed: number;
  /** 0-100 */
  completionRate: number;
  avgWatchSeconds: number;
  /** 0-100 */
  avgPercentWatched: number;
  /** 100 points, % of viewers who watched each 1% of the video. */
  retention: number[];
  /** 100 points, average viewing passes per viewer. */
  passes: number[];
  estimated: boolean;
  dropOffs: DropOffPoint[];
  rewatches: RewatchPoint[];
  learners: VideoLearnerRow[];
}

export interface CourseVideoAnalytics {
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  videos: VideoAnalytics[];
  totals: {
    videos: number;
    /** Distinct learners who watched at least one video. */
    viewers: number;
    watchSeconds: number;
    /** 0-100, completed views / all views. */
    completionRate: number;
  };
}

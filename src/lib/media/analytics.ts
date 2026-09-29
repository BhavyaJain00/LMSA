import "server-only";
import type { Database, LessonBlock, User, VideoWatch } from "@/lib/types";
import type { AnalyticsUser, CourseVideoAnalytics, VideoAnalytics, VideoLearnerRow } from "@/components/admin/video-analytics/types";
import { getDb } from "@/lib/db/store";
import { lessonHref } from "@/lib/data/courses";
import { percent } from "@/lib/utils";
import {
  RETENTION_BINS,
  coveragePercent,
  estimateBinsFromMax,
  findDropOffs,
  findRewatchHotspots,
  normalizeBins,
  summarizeRetention,
} from "./retention";

/**
 * Video analytics for course managers: per video viewers, completion, watch
 * time, audience retention (from `VideoWatch.bins`), drop-off and rewatch
 * hotspots and a per-learner breakdown.
 */

type VideoBlock = Extract<LessonBlock, { type: "video" }>;

function toAnalyticsUser(user: User): AnalyticsUser {
  return { id: user.id, name: user.name, username: user.username, email: user.email, avatarUrl: user.avatarUrl };
}

function learnerRow(watch: VideoWatch, user: User, duration: number): VideoLearnerRow {
  const hasBins = !!watch.bins && watch.bins.some((v) => v > 0);
  const bins = hasBins ? normalizeBins(watch.bins) : estimateBinsFromMax(watch.maxPositionSeconds, duration);
  const covered = bins.filter((v) => v > 0);
  const passes = covered.reduce((s, v) => s + v, 0);
  return {
    user: toAnalyticsUser(user),
    percentWatched: watch.completed && !hasBins && covered.length === 0 ? 100 : coveragePercent(bins),
    watchSeconds: Math.round(watch.watchSeconds),
    lastPositionSeconds: Math.round(watch.lastPositionSeconds),
    maxPositionSeconds: Math.round(watch.maxPositionSeconds),
    completed: watch.completed,
    replayFactor: covered.length ? Math.round((passes / covered.length) * 10) / 10 : 0,
    updatedAt: watch.updatedAt,
    estimated: !hasBins,
  };
}

function buildVideo(
  db: Database,
  users: Map<string, User>,
  lesson: Database["lessons"][number],
  block: VideoBlock,
  meta: { chapterTitle: string; chapterNumber: number; lessonNumber: number; courseSlug: string; videoIndex: number; videoCount: number },
): VideoAnalytics {
  const watches = db.videoWatches.filter((w) => w.lessonId === lesson.id && w.blockId === block.id && users.has(w.userId));
  const duration = block.duration || watches.reduce((max, w) => Math.max(max, w.durationSeconds || 0), 0);
  const summary = summarizeRetention(
    watches.map((w) => ({ bins: w.bins, maxPositionSeconds: w.maxPositionSeconds, durationSeconds: w.durationSeconds || duration })),
    duration,
  );
  const learners = watches
    .map((w) => learnerRow(w, users.get(w.userId)!, w.durationSeconds || duration))
    .sort((a, b) => b.percentWatched - a.percentWatched || b.watchSeconds - a.watchSeconds || a.user.name.localeCompare(b.user.name));
  const completed = watches.filter((w) => w.completed).length;
  const totalWatch = watches.reduce((s, w) => s + w.watchSeconds, 0);
  const title = block.title?.trim() || (meta.videoCount > 1 ? `${lesson.title} (video ${meta.videoIndex + 1})` : lesson.title);
  return {
    key: `${lesson.id}:${block.id}`,
    lessonId: lesson.id,
    blockId: block.id,
    title,
    lessonTitle: lesson.title,
    chapterTitle: meta.chapterTitle,
    position: `${meta.chapterNumber}.${meta.lessonNumber}`,
    learnHref: lessonHref(meta.courseSlug, { chapterNumber: meta.chapterNumber, lessonNumber: meta.lessonNumber }),
    editorHref: `/admin/courses/${lesson.courseId}/lessons/${lesson.id}`,
    duration,
    viewers: watches.length,
    completed,
    completionRate: percent(completed, watches.length),
    avgWatchSeconds: watches.length ? Math.round(totalWatch / watches.length) : 0,
    avgPercentWatched: learners.length ? Math.round(learners.reduce((s, l) => s + l.percentWatched, 0) / learners.length) : 0,
    retention: summary.retention.length === RETENTION_BINS ? summary.retention : new Array<number>(RETENTION_BINS).fill(0),
    passes: summary.passes,
    estimated: summary.estimated,
    dropOffs: summary.viewers >= 2 ? findDropOffs(summary.retention, duration) : [],
    rewatches: summary.viewers >= 2 ? findRewatchHotspots(summary, duration) : [],
    learners,
  };
}

function usersById(db: Database): Map<string, User> {
  return new Map(db.users.map((u) => [u.id, u]));
}

/** Analytics for every video of a course, in outline order. */
export async function getCourseVideoAnalytics(courseId: string): Promise<CourseVideoAnalytics | null> {
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return null;
  const users = usersById(db);
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const videos: VideoAnalytics[] = [];
  chapters.forEach((chapter, ci) => {
    const lessons = db.lessons.filter((l) => l.chapterId === chapter.id).sort((a, b) => a.order - b.order);
    lessons.forEach((lesson, li) => {
      const blocks = lesson.blocks.filter((b): b is VideoBlock => b.type === "video");
      blocks.forEach((block, bi) => {
        videos.push(
          buildVideo(db, users, lesson, block, {
            chapterTitle: chapter.title,
            chapterNumber: ci + 1,
            lessonNumber: li + 1,
            courseSlug: course.slug,
            videoIndex: bi,
            videoCount: blocks.length,
          }),
        );
      });
    });
  });

  const viewerIds = new Set<string>();
  let views = 0;
  let completedViews = 0;
  let watchSeconds = 0;
  for (const v of videos) {
    views += v.viewers;
    completedViews += v.completed;
    for (const l of v.learners) {
      viewerIds.add(l.user.id);
      watchSeconds += l.watchSeconds;
    }
  }
  return {
    courseId: course.id,
    courseTitle: course.title,
    courseSlug: course.slug,
    videos,
    totals: { videos: videos.length, viewers: viewerIds.size, watchSeconds, completionRate: percent(completedViews, views) },
  };
}

/** Analytics for the videos of one lesson (lesson editor statistics dialog). */
export async function getLessonVideoAnalytics(lessonId: string): Promise<{ courseId: string; videos: VideoAnalytics[] } | null> {
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const course = db.courses.find((c) => c.id === lesson.courseId);
  if (!course) return null;
  const chapters = db.chapters.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
  const ci = chapters.findIndex((c) => c.id === lesson.chapterId);
  const siblings = db.lessons.filter((l) => l.chapterId === lesson.chapterId).sort((a, b) => a.order - b.order);
  const li = siblings.findIndex((l) => l.id === lesson.id);
  const users = usersById(db);
  const blocks = lesson.blocks.filter((b): b is VideoBlock => b.type === "video");
  return {
    courseId: course.id,
    videos: blocks.map((block, bi) =>
      buildVideo(db, users, lesson, block, {
        chapterTitle: chapters[ci]?.title ?? "",
        chapterNumber: Math.max(1, ci + 1),
        lessonNumber: Math.max(1, li + 1),
        courseSlug: course.slug,
        videoIndex: bi,
        videoCount: blocks.length,
      }),
    ),
  };
}

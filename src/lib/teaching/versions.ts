import "server-only";
import type { Database, Lesson, LessonBlock, LessonVersion, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { computeLessonDuration, sanitizeBlocks } from "@/components/admin/courses/blocks";
import { formatUtcDateTime } from "@/components/learn/drip-shared";
import { preserveManagedVideoFields } from "@/lib/media/transcode/lesson-fields";
import { siteConfig } from "@/lib/config";
import { uid } from "@/lib/utils";
import {
  CURRENT_VERSION_ID,
  VERSION_LIMITS,
  buildTimeline,
  cleanVersionNote,
  diffLessonContent,
  resolveTimelineState,
  sameContent,
  versionsToPrune,
  type AssessmentNames,
  type LessonDiff,
  type RestoredLesson,
  type VersionCompareMode,
  type VersionContent,
  type VersionTimelineView,
} from "./version-shared";

/**
 * Lesson version history (server side): snapshots before every save, the
 * timeline and diffs for the history panel, and restoring an older version.
 * The rules live in `version-shared.ts`.
 */

const contentOf = (row: VersionContent): VersionContent => ({ title: row.title, blocks: row.blocks, instructorNotes: row.instructorNotes });

/**
 * Keep the lesson as it is right now, because a save is about to replace it
 * with `next`. Call inside `mutate`, before writing the lesson. Nothing is
 * stored when the save changes neither title, notes nor blocks. Older
 * versions beyond the limits, and versions of lessons that no longer exist,
 * are removed in the same write.
 */
export function recordLessonVersion(
  db: Pick<Database, "lessons" | "lessonVersions">,
  lesson: Lesson,
  savedById: string,
  opts: { next: VersionContent; at: string; note?: string },
): LessonVersion | null {
  if (sameContent(lesson, opts.next)) return null;
  const note = cleanVersionNote(opts.note);
  const version: LessonVersion = {
    id: uid("ver"),
    lessonId: lesson.id,
    title: lesson.title,
    // A copy: the live blocks keep changing (the media pipeline patches video blocks in place).
    blocks: JSON.parse(JSON.stringify(lesson.blocks)) as LessonBlock[],
    ...(lesson.instructorNotes ? { instructorNotes: lesson.instructorNotes } : {}),
    savedById,
    ...(note ? { note } : {}),
    createdAt: opts.at,
  };
  db.lessonVersions.push(version);

  const drop = new Set(
    versionsToPrune(
      db.lessonVersions.filter((v) => v.lessonId === lesson.id).map((v) => ({ id: v.id, createdAt: v.createdAt, size: JSON.stringify(v.blocks).length + (v.instructorNotes?.length ?? 0) })),
    ),
  );
  const lessonIds = new Set(db.lessons.map((l) => l.id));
  if (drop.size || db.lessonVersions.some((v) => !lessonIds.has(v.lessonId))) {
    db.lessonVersions = db.lessonVersions.filter((v) => !drop.has(v.id) && lessonIds.has(v.lessonId));
  }
  return version;
}

function assessmentNames(db: Pick<Database, "quizzes" | "assignments" | "exercises">): AssessmentNames {
  const titles = (rows: { id: string; title: string }[]) => Object.fromEntries(rows.map((r) => [r.id, r.title]));
  return { quizzes: titles(db.quizzes), assignments: titles(db.assignments), exercises: titles(db.exercises) };
}

/** The history of a lesson for the panel: every kept state, newest first, with its author. */
export async function getVersionTimeline(lesson: Lesson): Promise<VersionTimelineView> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const entries = buildTimeline(
    lesson,
    db.lessonVersions.filter((v) => v.lessonId === lesson.id),
  ).map((entry) => {
    const user = entry.savedById ? users.get(entry.savedById) : undefined;
    return { ...entry, author: user ? { name: user.name, ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}) } : null };
  });
  return { entries, limit: VERSION_LIMITS.perLesson };
}

/**
 * Compare a state of the lesson. "changes": with the state before it (what
 * that save changed). "current": with the live lesson (what restoring it
 * would undo). Null when the entry does not exist or has nothing to compare with.
 */
export async function getVersionDiff(lesson: Lesson, entryId: string, mode: VersionCompareMode): Promise<LessonDiff | null> {
  const db = await getDb();
  const resolved = resolveTimelineState(
    lesson,
    db.lessonVersions.filter((v) => v.lessonId === lesson.id),
    entryId,
  );
  if (!resolved) return null;
  const names = assessmentNames(db);
  if (mode === "current") return entryId === CURRENT_VERSION_ID ? null : diffLessonContent(resolved.content, contentOf(lesson), names);
  return resolved.previous ? diffLessonContent(resolved.previous, resolved.content, names) : null;
}

export type RestoreOutcome =
  | { ok: true; lesson: RestoredLesson; skippedBlocks: number; restoredFrom: string }
  | { ok: false; reason: "missing" | "unchanged" };

/**
 * Put a stored version back as the live lesson. Call inside `mutate`. The
 * current content is kept as a new version first, so a restore can itself be
 * undone. Quiz, assignment and exercise blocks whose target was deleted since
 * are left out, and video blocks keep the converted streams and transcript of
 * the same video when it is still in the lesson.
 */
export function restoreLessonVersion(db: Database, lessonId: string, versionId: string, user: Pick<User, "id">, now: number): RestoreOutcome {
  const row = db.lessons.find((l) => l.id === lessonId);
  const versions = db.lessonVersions.filter((v) => v.lessonId === lessonId);
  const version = versions.find((v) => v.id === versionId);
  if (!row || !version) return { ok: false, reason: "missing" };

  const { blocks: clean, errors } = sanitizeBlocks(JSON.parse(JSON.stringify(version.blocks)), {
    quizIds: new Set(db.quizzes.map((q) => q.id)),
    assignmentIds: new Set(db.assignments.map((a) => a.id)),
    exerciseIds: new Set(db.exercises.map((e) => e.id)),
  });
  const usable = errors._ ? [] : clean.filter((b) => !(errors[b.id] && (b.type === "quiz" || b.type === "assignment" || b.type === "exercise")));
  const blocks = preserveManagedVideoFields(row.blocks, usable, [siteConfig.appUrl]);
  const next: VersionContent = { title: version.title, blocks, instructorNotes: version.instructorNotes };
  if (sameContent(row, next)) return { ok: false, reason: "unchanged" };

  // The time the restored content was originally saved: the save before the one that replaced it.
  const timeline = buildTimeline(row, versions);
  const savedAt = timeline.find((entry) => entry.id === version.id)?.savedAt;
  const label = savedAt ? formatUtcDateTime(Date.parse(savedAt)) : "";
  const at = new Date(now).toISOString();
  recordLessonVersion(db, row, user.id, { next, at, note: label ? `Restored the version from ${label}` : "Restored the earliest kept version" });

  row.title = next.title;
  row.blocks = blocks;
  if (next.instructorNotes) row.instructorNotes = next.instructorNotes;
  else delete row.instructorNotes;
  row.durationSeconds = computeLessonDuration(blocks);
  row.updatedAt = at;
  return {
    ok: true,
    lesson: { title: row.title, blocks, instructorNotes: row.instructorNotes ?? "", durationSeconds: row.durationSeconds, updatedAt: at },
    skippedBlocks: version.blocks.length - blocks.length,
    restoredFrom: label,
  };
}

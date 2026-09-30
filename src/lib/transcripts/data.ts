import "server-only";
import type { Database, Lesson, LessonBlock, Transcript, TranscriptCue, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { getLessonAccess, type LessonAccess } from "@/lib/data/lessons";
import { canPlayLessonMedia } from "@/lib/media/access";
import { uid } from "@/lib/utils";

/**
 * Transcript storage helpers.
 *
 * A video block points at its transcript through `block.transcriptId`; that
 * pointer is the only link that counts. When the block's source file is
 * replaced, the lesson editor drops the pointer (see
 * `preserveManagedVideoFields`), so a transcript of the previous video is
 * never shown for the new one. Rows left without a pointer are removed the
 * next time a transcript is stored for that block.
 */

export type VideoBlock = Extract<LessonBlock, { type: "video" }>;

/** BCP 47 tag accepted for a transcript language. */
export const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;

export function findVideoBlock(lesson: Pick<Lesson, "blocks"> | null | undefined, blockId: string): VideoBlock | null {
  const block = lesson?.blocks.find((b) => b.id === blockId);
  return block && block.type === "video" ? block : null;
}

/** The transcript a video block points at (null when it has none). */
export function blockTranscript(db: Pick<Database, "transcripts">, block: Pick<VideoBlock, "transcriptId"> | null): Transcript | null {
  if (!block?.transcriptId) return null;
  return db.transcripts.find((t) => t.id === block.transcriptId) ?? null;
}

export interface UpsertTranscriptInput {
  lessonId: string;
  blockId: string;
  cues: TranscriptCue[];
  language: string;
  source: Transcript["source"];
  status: Transcript["status"];
  error?: string;
}

/**
 * Create or replace the transcript of a video block and point the block at
 * it (synchronous: call inside `mutate`). Returns null when the lesson or
 * block no longer exists.
 */
export function upsertBlockTranscript(db: Database, input: UpsertTranscriptInput, now = new Date().toISOString()): Transcript | null {
  const lesson = db.lessons.find((l) => l.id === input.lessonId);
  const block = findVideoBlock(lesson, input.blockId);
  if (!lesson || !block) return null;
  const existing = blockTranscript(db, block);
  const next: Transcript = {
    id: existing?.id ?? uid("trn"),
    lessonId: input.lessonId,
    blockId: input.blockId,
    language: input.language,
    cues: input.cues,
    source: input.source,
    status: input.status,
    ...(input.error ? { error: input.error } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Orphans of this block (older videos) go; the current row is replaced in place.
  db.transcripts = db.transcripts.filter((t) => t.id === next.id || !(t.lessonId === input.lessonId && t.blockId === input.blockId));
  const idx = db.transcripts.findIndex((t) => t.id === next.id);
  if (idx >= 0) db.transcripts[idx] = next;
  else db.transcripts.push(next);
  if (block.transcriptId !== next.id) {
    lesson.blocks = lesson.blocks.map((b) => (b.id === block.id && b.type === "video" ? { ...b, transcriptId: next.id } : b));
  }
  return next;
}

/** Update fields of a block's existing transcript in place (synchronous, inside `mutate`). */
export function patchBlockTranscript(db: Database, lessonId: string, blockId: string, patch: (t: Transcript) => Partial<Transcript>): Transcript | null {
  const lesson = db.lessons.find((l) => l.id === lessonId);
  const current = blockTranscript(db, findVideoBlock(lesson, blockId));
  if (!current) return null;
  const idx = db.transcripts.findIndex((t) => t.id === current.id);
  const next = { ...current, ...patch(current) };
  db.transcripts[idx] = next;
  return next;
}

/** Remove a block's transcript and its pointer (synchronous, inside `mutate`). Returns whether one existed. */
export function removeBlockTranscript(db: Database, lessonId: string, blockId: string): boolean {
  const lesson = db.lessons.find((l) => l.id === lessonId);
  const block = findVideoBlock(lesson, blockId);
  if (!lesson || !block) return false;
  const before = db.transcripts.length;
  db.transcripts = db.transcripts.filter((t) => !(t.lessonId === lessonId && t.blockId === blockId) && t.id !== block.transcriptId);
  if (block.transcriptId) {
    lesson.blocks = lesson.blocks.map((b) => {
      if (b.id !== blockId || b.type !== "video") return b;
      const copy = { ...b };
      delete copy.transcriptId;
      return copy;
    });
  }
  return db.transcripts.length !== before;
}

/* ------------------------------------------------------------------ */
/* Learner access                                                       */
/* ------------------------------------------------------------------ */

/** What a viewer sees of a transcript. */
export interface TranscriptView {
  id: string;
  language: string;
  source: Transcript["source"];
  updatedAt: string;
  cues: TranscriptCue[];
}

export type TranscriptReadResult =
  | { ok: true; access: LessonAccess; block: VideoBlock; transcript: Transcript | null }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * Resolve a block's transcript for `user` with the same rule as the video
 * itself: whoever may play the lesson's media may read its transcript.
 */
export async function readTranscriptFor(user: User | null, lessonId: string, blockId: string): Promise<TranscriptReadResult> {
  const access = await getLessonAccess(user, lessonId);
  if (!access) return { ok: false, status: 404, error: "This lesson no longer exists." };
  const block = findVideoBlock(access.lesson, blockId);
  if (!block) return { ok: false, status: 404, error: "This video is no longer part of the lesson." };
  if (!canPlayLessonMedia(access)) {
    return user ? { ok: false, status: 403, error: "You don't have access to this lesson yet." } : { ok: false, status: 401, error: "Sign in to read this transcript." };
  }
  const db = await getDb();
  return { ok: true, access, block, transcript: blockTranscript(db, block) };
}

export function toTranscriptView(t: Transcript): TranscriptView {
  return { id: t.id, language: t.language, source: t.source, updatedAt: t.updatedAt, cues: t.cues };
}

/** Whether learners should see the transcript (it has cues; an in-progress regeneration keeps the old ones visible). */
export function isTranscriptVisible(t: Transcript | null): t is Transcript {
  return !!t && t.cues.length > 0 && t.status !== "failed";
}

"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Course, Lesson, Transcript, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageCourse } from "@/lib/data/courses";
import { audit } from "@/lib/audit";
import { MAX_CUES, normalizeCues } from "@/lib/transcripts/cues";
import { LANGUAGE_PATTERN, blockTranscript, findVideoBlock, removeBlockTranscript, upsertBlockTranscript, type VideoBlock } from "@/lib/transcripts/data";
import { cancelAutoTranscript, requestAutoTranscript, transcriptionJobState, type TranscriptionJobState } from "@/lib/transcripts/auto";
import { toEditorTranscript, type CueTuple, type EditorTranscript } from "@/lib/transcripts/editor-shared";

/**
 * Transcript editor actions (course managers only): save the cue list,
 * delete the transcript, start or cancel automatic generation. The
 * transcript is linked to its video block through `block.transcriptId`,
 * which these actions maintain.
 */

interface Loaded {
  user: User;
  course: Course;
  lesson: Lesson;
  block: VideoBlock;
}

async function loadBlock(lessonId: unknown, blockId: unknown): Promise<Loaded | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Please log in again." };
  if (typeof lessonId !== "string" || typeof blockId !== "string" || !lessonId || !blockId) return { error: "Choose a video first." };
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId);
  if (!lesson) return { error: "This lesson no longer exists." };
  const course = db.courses.find((c) => c.id === lesson.courseId);
  if (!course) return { error: "This course no longer exists." };
  if (!canManageCourse(user, course)) return { error: "You do not have permission to edit this lesson's transcripts." };
  const block = findVideoBlock(lesson, blockId);
  if (!block) return { error: "This video is no longer part of the lesson." };
  return { user, course, lesson, block };
}

function revalidateTranscript(course: Pick<Course, "id" | "slug">, lessonId: string) {
  revalidatePath(`/admin/courses/${course.id}/lessons/${lessonId}/transcript`);
  revalidatePath(`/admin/courses/${course.id}/lessons/${lessonId}`);
  revalidatePath(`/courses/${course.slug}`, "layout");
}

function languageOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return LANGUAGE_PATTERN.test(v) ? v : null;
}

export interface SaveTranscriptInput {
  lessonId: string;
  blockId: string;
  language: string;
  /** Cues as `[start, end, text]` (compact, to stay well inside the request size limit). */
  cues: CueTuple[];
  /** `updatedAt` of the version the editor started from (null for a new transcript). */
  baseUpdatedAt: string | null;
  /** "upload" when the cues come straight from an imported file, else "manual". */
  origin?: "manual" | "upload";
}

/** Save the editor's cue list as the block's transcript. */
export async function saveTranscriptAction(input: SaveTranscriptInput): Promise<ActionResult<{ transcript: EditorTranscript }>> {
  const loaded = await loadBlock(input?.lessonId, input?.blockId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course, lesson, block } = loaded;

  const language = languageOf(input.language);
  if (!language) return { ok: false, error: "Enter a language code such as en, hi or pt-BR.", fieldErrors: { language: "Use a code such as en, hi or pt-BR." } };
  if (!Array.isArray(input.cues)) return { ok: false, error: "The captions could not be read." };
  if (input.cues.length > MAX_CUES) return { ok: false, error: `A transcript can hold at most ${MAX_CUES.toLocaleString("en-US")} captions.` };
  const cues = normalizeCues(input.cues.map((c) => (Array.isArray(c) ? { start: c[0], end: c[1], text: c[2] } : null)));
  if (!cues.length) return { ok: false, error: "Add at least one caption with text, or delete the transcript instead." };

  if (transcriptionJobState(lesson.id, block.id)) {
    return { ok: false, error: "A transcript is being generated for this video. Wait for it to finish or cancel it, then save." };
  }

  let conflict: Transcript | null = null;
  const saved = await mutate((db) => {
    const current = blockTranscript(db, findVideoBlock(db.lessons.find((l) => l.id === lesson.id), block.id));
    if ((current?.updatedAt ?? null) !== (input.baseUpdatedAt ?? null)) {
      conflict = current;
      return null;
    }
    return upsertBlockTranscript(db, {
      lessonId: lesson.id,
      blockId: block.id,
      cues,
      language,
      source: input.origin === "upload" && current?.source !== "manual" ? "upload" : "manual",
      status: "ready",
    });
  });
  if (!saved) {
    const other = conflict as Transcript | null;
    return {
      ok: false,
      error: other
        ? "This transcript changed since you opened it (someone saved it, or an automatic transcript finished). Reload to see the latest version before saving."
        : "This transcript was deleted since you opened it. Reload the page to start again.",
      fieldErrors: { conflict: "1" },
    };
  }

  await audit(user, "transcript.save", { type: "lesson", id: lesson.id }, { blockId: block.id, cues: cues.length, language, source: saved.source });
  revalidateTranscript(course, lesson.id);
  return { ok: true, data: { transcript: toEditorTranscript(saved) }, message: `Saved ${cues.length} ${cues.length === 1 ? "caption" : "captions"}.` };
}

/** Delete the block's transcript (and stop a generation in progress). */
export async function deleteTranscriptAction(lessonId: string, blockId: string): Promise<ActionResult> {
  const loaded = await loadBlock(lessonId, blockId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course, lesson, block } = loaded;
  const stopped = await cancelAutoTranscript(lesson.id, block.id);
  const removed = await mutate((db) => removeBlockTranscript(db, lesson.id, block.id));
  if (!removed && !stopped) return { ok: false, error: "This video has no transcript to delete." };
  await audit(user, "transcript.delete", { type: "lesson", id: lesson.id }, { blockId: block.id });
  revalidateTranscript(course, lesson.id);
  return { ok: true, data: undefined, message: "Transcript deleted." };
}

/** Start automatic transcription of the block's video (replaces the current cues when it finishes). */
export async function generateTranscriptAction(lessonId: string, blockId: string, language?: string | null): Promise<ActionResult<{ job: TranscriptionJobState; transcript: EditorTranscript | null }>> {
  const loaded = await loadBlock(lessonId, blockId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { user, course, lesson, block } = loaded;
  const hint = language ? languageOf(language) : null;
  if (language && !hint) return { ok: false, error: "Enter a language code such as en, hi or pt-BR, or leave it empty to detect the language." };

  const result = await requestAutoTranscript(lesson.id, block.id, { manual: true, language: hint, requestedBy: user.id });
  if (!result.queued) return { ok: false, error: result.reason };
  await audit(user, "transcript.generate", { type: "lesson", id: lesson.id }, { blockId: block.id, language: hint ?? "auto" });
  revalidateTranscript(course, lesson.id);
  const db = await getDb();
  const t = blockTranscript(db, findVideoBlock(db.lessons.find((l) => l.id === lesson.id), block.id));
  return { ok: true, data: { job: result.state, transcript: t ? toEditorTranscript(t) : null }, message: "Transcript generation started. You can leave this page; you'll be notified when it's done." };
}

/** Stop a queued or running generation. */
export async function cancelTranscriptGenerationAction(lessonId: string, blockId: string): Promise<ActionResult> {
  const loaded = await loadBlock(lessonId, blockId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { course, lesson, block } = loaded;
  if (!(await cancelAutoTranscript(lesson.id, block.id))) return { ok: false, error: "No transcript is being generated for this video." };
  revalidateTranscript(course, lesson.id);
  return { ok: true, data: undefined, message: "Generation cancelled." };
}

"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, LessonNote, NoteColor, User } from "@/lib/types";
import type { NoteItem } from "@/components/learn/types";
import { getCurrentUser } from "@/lib/auth/session";
import { findById, insert, remove, update } from "@/lib/db/store";
import { getLessonAccess, getLessonLink, type LessonAccess } from "@/lib/data/lessons";
import { noteColors } from "@/lib/config";
import { fd, uid } from "@/lib/utils";

const MAX_NOTE = 5000;
const MAX_HIGHLIGHT = 2000;
const MAX_TIMESTAMP = 24 * 60 * 60;

function toItem(n: LessonNote): NoteItem {
  return {
    id: n.id,
    color: n.color,
    note: n.note,
    highlightedText: n.highlightedText,
    timestampSeconds: n.timestampSeconds,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

function parseColor(raw: string): NoteColor | null {
  return (noteColors as readonly string[]).includes(raw) ? (raw as NoteColor) : null;
}

function normalizeHighlight(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function revalidateLessons(lessonHref?: string) {
  if (lessonHref) revalidatePath(lessonHref);
  revalidatePath("/(learn)/courses/[slug]/learn/[ref]", "page");
}

type Gate = { ok: true; user: User; access: LessonAccess } | { ok: false; error: string };

/** Notes are private to enrolled learners, on lessons they can open, when the feature is on. */
async function gate(lessonId: string): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to take notes." };
  const access = lessonId ? await getLessonAccess(user, lessonId) : null;
  if (!access) return { ok: false, error: "This lesson no longer exists." };
  if (!access.settings.features.notes) return { ok: false, error: "Notes are turned off on this site." };
  if (!access.enrolled) return { ok: false, error: "Enroll in this course to take notes." };
  if (!access.canView) return { ok: false, error: "You do not have access to this lesson." };
  return { ok: true, user, access };
}

/** Load a note owned by the current user. */
async function ownNote(noteId: string): Promise<{ ok: true; user: User; note: LessonNote } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to manage your notes." };
  const note = noteId ? await findById("notes", noteId) : null;
  if (!note) return { ok: false, error: "This note no longer exists." };
  if (note.userId !== user.id) return { ok: false, error: "You can only change your own notes." };
  return { ok: true, user, note };
}

/**
 * Create a note from the Notes panel. Fields: lessonId, note (markdown),
 * color, optional timestampSeconds (video time) and highlightedText (quote).
 */
export async function createNoteAction(_prev: ActionResult<NoteItem> | null, formData: FormData): Promise<ActionResult<NoteItem>> {
  const lessonId = fd(formData, "lessonId");
  const text = fd(formData, "note");
  const colorRaw = fd(formData, "color") || "yellow";
  const timestampRaw = fd(formData, "timestampSeconds");
  const highlight = normalizeHighlight(fd(formData, "highlightedText"));

  const fieldErrors: Record<string, string> = {};
  const color = parseColor(colorRaw);
  if (!color) fieldErrors.color = "Pick one of the note colors.";
  if (!text && !highlight) fieldErrors.note = "Write something before saving the note.";
  if (text.length > MAX_NOTE) fieldErrors.note = `Notes can be at most ${MAX_NOTE.toLocaleString()} characters.`;
  if (highlight.length > MAX_HIGHLIGHT) fieldErrors.note = "The highlighted passage is too long. Select a shorter piece of text.";
  let timestampSeconds: number | undefined;
  if (timestampRaw) {
    const n = Number(timestampRaw);
    if (!Number.isFinite(n) || n < 0 || n > MAX_TIMESTAMP) fieldErrors.timestampSeconds = "The video time is not valid.";
    else timestampSeconds = Math.floor(n);
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };

  const g = await gate(lessonId);
  if (!g.ok) return g;

  const now = new Date().toISOString();
  const note: LessonNote = {
    id: uid("note"),
    userId: g.user.id,
    courseId: g.access.course.id,
    lessonId: g.access.lesson.id,
    color: color!,
    highlightedText: highlight || undefined,
    timestampSeconds,
    note: text,
    createdAt: now,
    updatedAt: now,
  };
  await insert("notes", note);
  revalidateLessons(g.access.href);
  return { ok: true, data: toItem(note), message: "Note saved" };
}

/** Update the text and color of one of your notes. Fields: noteId, note, color. */
export async function updateNoteAction(_prev: ActionResult<NoteItem> | null, formData: FormData): Promise<ActionResult<NoteItem>> {
  const noteId = fd(formData, "noteId");
  const text = fd(formData, "note");
  const color = parseColor(fd(formData, "color") || "yellow");

  const owned = await ownNote(noteId);
  if (!owned.ok) return owned;

  const fieldErrors: Record<string, string> = {};
  if (!color) fieldErrors.color = "Pick one of the note colors.";
  if (!text && !owned.note.highlightedText) fieldErrors.note = "A note needs some text. Delete it instead if you no longer need it.";
  if (text.length > MAX_NOTE) fieldErrors.note = `Notes can be at most ${MAX_NOTE.toLocaleString()} characters.`;
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };

  const g = await gate(owned.note.lessonId);
  if (!g.ok) return g;

  const updated = await update("notes", owned.note.id, { note: text, color: color!, updatedAt: new Date().toISOString() });
  if (!updated) return { ok: false, error: "This note no longer exists." };
  revalidateLessons(g.access.href);
  return { ok: true, data: toItem(updated), message: "Note updated" };
}

/** Delete one of your notes (also removes its highlight from the lesson). */
export async function deleteNoteAction(noteId: string): Promise<ActionResult> {
  const owned = await ownNote(typeof noteId === "string" ? noteId : "");
  if (!owned.ok) return owned;
  await remove("notes", owned.note.id);
  const link = await getLessonLink(owned.note.lessonId);
  revalidateLessons(link?.href);
  return { ok: true, data: undefined, message: owned.note.highlightedText && !owned.note.note ? "Highlight removed" : "Note deleted" };
}

/** Save a colored highlight of text selected in the lesson content. */
export async function createHighlightAction(input: { lessonId: string; highlightedText: string; color: string }): Promise<ActionResult<NoteItem>> {
  const highlight = normalizeHighlight(typeof input?.highlightedText === "string" ? input.highlightedText : "");
  const color = parseColor(typeof input?.color === "string" ? input.color : "");
  if (!highlight) return { ok: false, error: "Select some text in the lesson to highlight it." };
  if (highlight.length > MAX_HIGHLIGHT) return { ok: false, error: "That selection is too long to highlight. Select a shorter passage." };
  if (!color) return { ok: false, error: "Pick one of the highlight colors." };

  const g = await gate(typeof input?.lessonId === "string" ? input.lessonId : "");
  if (!g.ok) return g;

  const now = new Date().toISOString();
  const note: LessonNote = {
    id: uid("note"),
    userId: g.user.id,
    courseId: g.access.course.id,
    lessonId: g.access.lesson.id,
    color,
    highlightedText: highlight,
    note: "",
    createdAt: now,
    updatedAt: now,
  };
  await insert("notes", note);
  revalidateLessons(g.access.href);
  return { ok: true, data: toItem(note), message: "Highlight saved" };
}

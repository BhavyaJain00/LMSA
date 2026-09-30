import type { LessonBlock, LessonBlockType, LessonVersion } from "@/lib/types";
import { BLOCK_LABELS, CALLOUT_LABELS } from "@/components/admin/courses/blocks";
import { formatBytes, formatTime, pluralize } from "@/lib/utils";
import { diffSequence, diffText, type TextDiff } from "./text-diff";

/**
 * Lesson history rules shared by the server and the history panel: what a
 * version holds, how many are kept, the timeline shown to authors and the
 * block-level comparison of two versions. Pure functions only.
 *
 * Storage model: a `LessonVersion` row is written right before a save (or a
 * restore) replaces the lesson. It holds the content as it was BEFORE that
 * save, together with who saved, when, and an optional note. The timeline
 * turns the rows back into the states an author thinks in: "the lesson as
 * Ana saved it on Monday" is the content of the NEXT row (or the live lesson
 * for the newest state), described by the row of Ana's own save.
 */

/** The part of a lesson that history keeps. */
export interface VersionContent {
  title: string;
  blocks: LessonBlock[];
  instructorNotes?: string;
}

export const VERSION_LIMITS = {
  /** Versions kept per lesson (the oldest are dropped first). */
  perLesson: 50,
  /** Stored content per lesson, in characters of JSON; the oldest versions go first. */
  maxCharsPerLesson: 6_000_000,
  /** Never dropped for size, however large the lesson is. */
  keepAlways: 5,
  noteMax: 200,
} as const;

/* ------------------------------------------------------------------ */
/* Comparing content                                                   */
/* ------------------------------------------------------------------ */

/** Video fields written by the media pipeline, not by authors. */
const MANAGED_VIDEO_FIELDS = ["hlsUrl", "transcode", "storageKey", "transcriptId"] as const;

/** A block as authors edit it: without the fields the media pipeline manages. */
export function authoredBlock(block: LessonBlock): LessonBlock {
  if (block.type !== "video") return block;
  const copy: Record<string, unknown> = { ...block };
  for (const field of MANAGED_VIDEO_FIELDS) delete copy[field];
  return copy as unknown as LessonBlock;
}

/** JSON with object keys in a fixed order and without empty values, so equal content gives equal text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const blockKey = (block: LessonBlock) => canonical(authoredBlock(block));
const notesOf = (content: VersionContent) => (content.instructorNotes ?? "").trim();

/** Same title, notes and authored blocks (order included). */
export function sameContent(a: VersionContent, b: VersionContent): boolean {
  if (a.title !== b.title || notesOf(a) !== notesOf(b) || a.blocks.length !== b.blocks.length) return false;
  return a.blocks.every((block, i) => blockKey(block) === blockKey(b.blocks[i]!));
}

/* ------------------------------------------------------------------ */
/* Retention                                                           */
/* ------------------------------------------------------------------ */

export interface StoredVersionSize {
  id: string;
  createdAt: string;
  /** Characters of JSON the version holds. */
  size: number;
}

/**
 * Ids of the versions of ONE lesson to delete: everything beyond the newest
 * `perLesson`, and older versions once the stored content passes the size
 * budget (the newest `keepAlways` always stay). Rows are given in insertion
 * order, which breaks ties between equal timestamps.
 */
export function versionsToPrune(rows: readonly StoredVersionSize[], limits: { perLesson: number; maxCharsPerLesson: number; keepAlways: number } = VERSION_LIMITS): string[] {
  const newestFirst = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.createdAt === b.row.createdAt ? b.index - a.index : a.row.createdAt < b.row.createdAt ? 1 : -1))
    .map((entry) => entry.row);
  const drop: string[] = [];
  let total = 0;
  newestFirst.forEach((row, i) => {
    total += Math.max(0, row.size);
    if (i >= limits.perLesson || (i >= limits.keepAlways && total > limits.maxCharsPerLesson)) drop.push(row.id);
  });
  return drop;
}

/** Trimmed single-line note, cut to the limit ("" when there is none). */
export function cleanVersionNote(note: unknown): string {
  if (typeof note !== "string") return "";
  return note.replace(/\s+/g, " ").trim().slice(0, VERSION_LIMITS.noteMax);
}

/* ------------------------------------------------------------------ */
/* Change summaries                                                    */
/* ------------------------------------------------------------------ */

export interface ChangeSummary {
  added: number;
  removed: number;
  /** Blocks whose content changed (moved or not). */
  changed: number;
  /** Blocks that only changed position. */
  moved: number;
  title: boolean;
  notes: boolean;
}

export function hasChanges(summary: ChangeSummary): boolean {
  return summary.added + summary.removed + summary.changed + summary.moved > 0 || summary.title || summary.notes;
}

/** "2 blocks edited, 1 added, title changed" (or "No changes"). */
export function describeChange(summary: ChangeSummary): string {
  const parts: string[] = [];
  if (summary.changed) parts.push(`${pluralize(summary.changed, "block")} edited`);
  if (summary.added) parts.push(`${pluralize(summary.added, "block")} added`);
  if (summary.removed) parts.push(`${pluralize(summary.removed, "block")} removed`);
  if (summary.moved) parts.push(`${pluralize(summary.moved, "block")} moved`);
  if (summary.title) parts.push("title changed");
  if (summary.notes) parts.push("notes changed");
  return parts.length ? parts.join(", ") : "No changes";
}

interface AlignedBlock {
  status: "unchanged" | "changed" | "added" | "removed";
  moved: boolean;
  before?: LessonBlock;
  after?: LessonBlock;
  beforeIndex?: number;
  afterIndex?: number;
}

/**
 * Match the blocks of two versions by id. The LCS of the two id sequences
 * decides which blocks stayed in place; a block found on both sides outside
 * that alignment was moved and is listed once, at its new position.
 */
function alignBlocks(before: readonly LessonBlock[], after: readonly LessonBlock[]): AlignedBlock[] {
  const beforeById = new Map(before.map((block, index) => [block.id, { block, index }]));
  const afterById = new Map(after.map((block, index) => [block.id, { block, index }]));
  const { ops } = diffSequence(
    before.map((b) => b.id),
    after.map((b) => b.id),
  );
  const out: AlignedBlock[] = [];
  for (const op of ops) {
    const old = beforeById.get(op.value);
    const next = afterById.get(op.value);
    if (op.type === "remove") {
      if (!next) out.push({ status: "removed", moved: false, before: old!.block, beforeIndex: old!.index });
      continue;
    }
    if (!old) {
      out.push({ status: "added", moved: false, after: next!.block, afterIndex: next!.index });
      continue;
    }
    out.push({
      status: blockKey(old.block) === blockKey(next!.block) ? "unchanged" : "changed",
      moved: op.type === "add",
      before: old.block,
      after: next!.block,
      beforeIndex: old.index,
      afterIndex: next!.index,
    });
  }
  return out;
}

function summarize(before: VersionContent, after: VersionContent, aligned: readonly AlignedBlock[]): ChangeSummary {
  const summary: ChangeSummary = { added: 0, removed: 0, changed: 0, moved: 0, title: before.title !== after.title, notes: notesOf(before) !== notesOf(after) };
  for (const row of aligned) {
    if (row.status === "added") summary.added++;
    else if (row.status === "removed") summary.removed++;
    else if (row.status === "changed") summary.changed++;
    else if (row.moved) summary.moved++;
  }
  return summary;
}

/** What changed between two versions, as counts. */
export function summarizeChange(before: VersionContent, after: VersionContent): ChangeSummary {
  return summarize(before, after, alignBlocks(before.blocks, after.blocks));
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export interface TimelineEntry {
  /** "current" for the live lesson, otherwise the id of the stored version holding this state. */
  id: string;
  current: boolean;
  /** Version row describing the save that produced this state (its note is this state's note); null for the oldest kept state. */
  metaId: string | null;
  savedById: string | null;
  savedAt: string | null;
  note: string | null;
  title: string;
  blockCount: number;
  /** Changes compared with the state before it; null for the oldest kept state. */
  change: ChangeSummary | null;
  /** The content equals the live lesson, so restoring it would change nothing. */
  sameAsCurrent: boolean;
}

export const CURRENT_VERSION_ID = "current";

/** Versions of one lesson, oldest first (insertion order breaks ties). */
export function sortVersions<T extends Pick<LessonVersion, "createdAt">>(versions: readonly T[]): T[] {
  return versions
    .map((version, index) => ({ version, index }))
    .sort((a, b) => (a.version.createdAt === b.version.createdAt ? a.index - b.index : a.version.createdAt < b.version.createdAt ? -1 : 1))
    .map((entry) => entry.version);
}

/**
 * The states of a lesson, newest first: the live lesson, then every stored
 * state. `versions` are the rows of this lesson in any order.
 */
export function buildTimeline(lesson: VersionContent & { updatedAt: string }, versions: readonly LessonVersion[]): TimelineEntry[] {
  const rows = sortVersions(versions);
  // states[k] for k < rows.length is the content held by rows[k]; the last state is the live lesson.
  const states: VersionContent[] = [...rows, lesson];
  const entries: TimelineEntry[] = [];
  for (let k = states.length - 1; k >= 0; k--) {
    const state = states[k]!;
    const current = k === rows.length;
    const meta = k > 0 ? rows[k - 1]! : null;
    entries.push({
      id: current ? CURRENT_VERSION_ID : rows[k]!.id,
      current,
      metaId: meta?.id ?? null,
      savedById: meta?.savedById ?? null,
      // Without any history the only thing known about the live lesson is when it last changed.
      savedAt: meta?.createdAt ?? (current ? lesson.updatedAt : null),
      note: meta?.note?.trim() || null,
      title: state.title,
      blockCount: state.blocks.length,
      change: k > 0 ? summarizeChange(states[k - 1]!, state) : null,
      sameAsCurrent: current || sameContent(state, lesson),
    });
  }
  return entries;
}

/** The content of a timeline entry, plus the state right before it (null for the oldest). */
export function resolveTimelineState(
  lesson: VersionContent,
  versions: readonly LessonVersion[],
  entryId: string,
): { content: VersionContent; previous: VersionContent | null } | null {
  const rows = sortVersions(versions);
  const states: VersionContent[] = [...rows, lesson];
  const index = entryId === CURRENT_VERSION_ID ? rows.length : rows.findIndex((row) => row.id === entryId);
  if (index === -1) return null;
  return { content: states[index]!, previous: index > 0 ? states[index - 1]! : null };
}

/* ------------------------------------------------------------------ */
/* Block-level diff                                                    */
/* ------------------------------------------------------------------ */

/** Titles of the assessments blocks point at, by id (deleted ones are missing). */
export interface AssessmentNames {
  quizzes: Record<string, string>;
  assignments: Record<string, string>;
  exercises: Record<string, string>;
}

export interface FieldChange {
  label: string;
  before: string | null;
  after: string | null;
}

export interface BlockDiff {
  id: string;
  type: LessonBlockType;
  status: "unchanged" | "changed" | "added" | "removed";
  /** Also changed position (only set for blocks present on both sides). */
  moved: boolean;
  /** "Markdown", "Video: Introduction", "Quiz: Basics". */
  label: string;
  /** 1-based positions. */
  beforePosition: number | null;
  afterPosition: number | null;
  /** Line diff of the block's text (markdown, callout, code). */
  text: TextDiff | null;
  /** Changed settings; for added and removed blocks every setting that has a value. */
  fields: FieldChange[];
}

export interface LessonDiff {
  title: FieldChange | null;
  notes: TextDiff | null;
  blocks: BlockDiff[];
  summary: ChangeSummary;
  identical: boolean;
}

type Field = [label: string, value: string];

function refName(names: Record<string, string>, id: string, kind: string): string {
  if (!id) return `No ${kind} selected`;
  return names[id] ?? `Deleted ${kind}`;
}

/** The settings of a block as label/value pairs (text content is compared separately). */
function blockFields(block: LessonBlock, names: AssessmentNames): Field[] {
  const fields: Field[] = [];
  const add = (label: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== "") fields.push([label, String(value)]);
  };
  switch (block.type) {
    case "markdown":
      break;
    case "callout":
      add("Style", CALLOUT_LABELS[block.tone]);
      break;
    case "code":
      add("Language", block.language);
      break;
    case "video":
      add("Title", block.title);
      add("Video", block.src);
      add("Poster image", block.posterUrl);
      add("Captions", block.captionsUrl);
      add("Duration", block.duration ? formatTime(block.duration) : undefined);
      add("Chapters", (block.chapters ?? []).map((c) => `${formatTime(c.time)} ${c.title}`).join("\n"));
      add("In-video quizzes", (block.quizMarkers ?? []).map((m) => `${formatTime(m.time)} ${refName(names.quizzes, m.quizId, "quiz")}`).join("\n"));
      add("Quality options", (block.sources ?? []).map((s) => `${s.label}: ${s.src}`).join("\n"));
      break;
    case "audio":
      add("Title", block.title);
      add("Audio", block.src);
      add("Duration", block.duration ? formatTime(block.duration) : undefined);
      break;
    case "pdf":
      add("Title", block.title);
      add("PDF", block.src);
      break;
    case "image":
      add("Image", block.src);
      add("Alt text", block.alt);
      add("Caption", block.caption);
      break;
    case "file":
      add("Title", block.title);
      add("File", block.src);
      add("Size", block.sizeBytes ? formatBytes(block.sizeBytes) : undefined);
      break;
    case "embed":
      add("Title", block.title);
      add("Page", block.src);
      add("Height", block.height ? `${block.height}px` : undefined);
      break;
    case "quiz":
      add("Quiz", refName(names.quizzes, block.quizId, "quiz"));
      break;
    case "assignment":
      add("Assignment", refName(names.assignments, block.assignmentId, "assignment"));
      break;
    case "exercise":
      add("Exercise", refName(names.exercises, block.exerciseId, "exercise"));
      break;
  }
  return fields;
}

/** The multi-line text of a block, or null for blocks without one. */
function blockText(block: LessonBlock): string | null {
  if (block.type === "markdown" || block.type === "callout") return block.content;
  if (block.type === "code") return block.code;
  return null;
}

function blockLabel(block: LessonBlock, names: AssessmentNames): string {
  const base = BLOCK_LABELS[block.type];
  let detail: string | undefined;
  if (block.type === "quiz") detail = names.quizzes[block.quizId];
  else if (block.type === "assignment") detail = names.assignments[block.assignmentId];
  else if (block.type === "exercise") detail = names.exercises[block.exerciseId];
  else if (block.type === "video" || block.type === "audio" || block.type === "pdf" || block.type === "file" || block.type === "embed") detail = block.title;
  else if (block.type === "image") detail = block.caption || block.alt;
  return detail ? `${base}: ${detail}` : base;
}

function fieldChanges(before: LessonBlock | undefined, after: LessonBlock | undefined, names: AssessmentNames): FieldChange[] {
  const old = new Map(before ? blockFields(before, names) : []);
  const next = new Map(after ? blockFields(after, names) : []);
  const labels = [...new Set([...old.keys(), ...next.keys()])];
  const out: FieldChange[] = [];
  for (const label of labels) {
    const a = old.get(label) ?? null;
    const b = next.get(label) ?? null;
    if (a !== b) out.push({ label, before: a, after: b });
  }
  return out;
}

/**
 * Block-level comparison of two versions: which blocks were added, removed,
 * edited or moved, with a line diff of text blocks and the changed settings
 * of the others. Blocks keep the order of the newer version; removed blocks
 * sit where they used to be.
 */
export function diffLessonContent(before: VersionContent, after: VersionContent, names: AssessmentNames, opts: { context?: number } = {}): LessonDiff {
  const aligned = alignBlocks(before.blocks, after.blocks);
  const summary = summarize(before, after, aligned);
  const blocks: BlockDiff[] = aligned.map((row): BlockDiff => {
    const shown = (row.after ?? row.before)!;
    const oldText = row.before ? blockText(row.before) : null;
    const newText = row.after ? blockText(row.after) : null;
    const hasText = oldText !== null || newText !== null;
    const textChanged = row.status !== "unchanged" && hasText && (oldText ?? "") !== (newText ?? "");
    return {
      id: shown.id,
      type: shown.type,
      status: row.status,
      moved: row.moved,
      label: blockLabel(shown, names),
      beforePosition: row.beforeIndex === undefined ? null : row.beforeIndex + 1,
      afterPosition: row.afterIndex === undefined ? null : row.afterIndex + 1,
      text: textChanged ? diffText(oldText ?? "", newText ?? "", { context: opts.context }) : null,
      fields: row.status === "unchanged" ? [] : fieldChanges(row.before, row.after, names),
    };
  });
  return {
    title: summary.title ? { label: "Title", before: before.title, after: after.title } : null,
    notes: summary.notes ? diffText(notesOf(before), notesOf(after), { context: opts.context }) : null,
    blocks,
    summary,
    identical: !hasChanges(summary),
  };
}

/* ------------------------------------------------------------------ */
/* View models (server actions → history panel)                        */
/* ------------------------------------------------------------------ */

export interface VersionAuthor {
  name: string;
  avatarUrl?: string;
}

export interface VersionTimelineRow extends TimelineEntry {
  author: VersionAuthor | null;
}

export interface VersionTimelineView {
  entries: VersionTimelineRow[];
  /** Most versions kept per lesson. */
  limit: number;
}

/** "changes": what the save that produced a version changed. "current": that version against the live lesson. */
export type VersionCompareMode = "changes" | "current";

/** What the editor needs to show a restored lesson without reloading. */
export interface RestoredLesson {
  title: string;
  blocks: LessonBlock[];
  instructorNotes: string;
  durationSeconds: number;
  updatedAt: string;
}

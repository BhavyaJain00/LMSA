import "server-only";
import type { SegmentFilter } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { evaluateSegment, normalizeSegmentFilter, type SegmentExclusions, type SegmentRecipient, type SegmentResult } from "./segments";

/**
 * Segments evaluated against the live database: the recipient list for a
 * send, the live preview shown by the segment builder, and the course
 * choices the builder offers.
 */

export interface CourseOption {
  id: string;
  title: string;
  published: boolean;
}

/** Every course, published first, for the course pickers. */
export async function segmentCourseOptions(): Promise<CourseOption[]> {
  const db = await getDb();
  return db.courses
    .map((c) => ({ id: c.id, title: c.title, published: c.published }))
    .sort((a, b) => Number(b.published) - Number(a.published) || a.title.localeCompare(b.title));
}

/** Validate a filter against the courses that exist. */
export async function cleanSegmentFilter(raw: unknown): Promise<SegmentFilter> {
  const db = await getDb();
  return normalizeSegmentFilter(raw, new Set(db.courses.map((c) => c.id)));
}

/** Everyone the segment reaches right now. */
export async function resolveSegment(filter: SegmentFilter, now: number = Date.now()): Promise<SegmentResult> {
  const db = await getDb();
  return evaluateSegment(db, filter, now);
}

export interface SegmentPreview {
  count: number;
  members: number;
  leads: number;
  excluded: SegmentExclusions;
  /** The first recipients in list order. */
  sample: Pick<SegmentRecipient, "kind" | "email" | "name">[];
}

export const SEGMENT_SAMPLE_SIZE = 8;

export async function previewSegment(filter: SegmentFilter, sampleSize: number = SEGMENT_SAMPLE_SIZE): Promise<SegmentPreview> {
  const { recipients, excluded } = await resolveSegment(filter);
  let members = 0;
  for (const r of recipients) if (r.kind === "member") members++;
  return {
    count: recipients.length,
    members,
    leads: recipients.length - members,
    excluded,
    sample: recipients.slice(0, sampleSize).map((r) => ({ kind: r.kind, email: r.email, name: r.name })),
  };
}

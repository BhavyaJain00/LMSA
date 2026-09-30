"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionResult, Settings, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { findById, getDb, mutate } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { audit } from "@/lib/audit";
import { fd, fdBool } from "@/lib/utils";
import { migrateLocalToRemote, testStorageConnection, type ConnectionStep } from "@/lib/storage";
import { contentTypeForKey, runMediaMaintenance, type MediaMaintenanceResult } from "@/lib/media/maintenance";
import { detectFfmpeg, type FfmpegStatus } from "@/lib/media/transcode/ffmpeg";
import { SUPPORTED_RENDITIONS, normalizeRenditions } from "@/lib/media/transcode/plan";
import { SAFE_ID } from "@/lib/media/transcode/lesson-fields";
import { getBlockMediaStatus, type BlockMediaStatus } from "@/lib/media/transcode/status";
import { cancelTranscodeJob, enqueueTranscode, retryFailedTranscodes, retryTranscodeJob, syncAllTranscodes } from "@/lib/media/transcode/queue";

/**
 * Admin → Settings → Storage & video (CDN, adaptive streaming, renditions,
 * automatic captions, connection test, conversion queue) and the lesson
 * editor's per-video conversion controls (course managers).
 */

const SETTINGS_PATH = "/admin/settings/storage";

async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

const NOT_ADMIN = { ok: false as const, error: "Only administrators can change storage settings." };

/** Validate a CDN origin: http(s) URL without query or fragment; returns the value without a trailing slash. */
function normalizeCdnBaseUrl(raw: string): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: true, value: undefined };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Enter a full URL such as https://cdn.example.com." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "The CDN URL must start with https://." };
  if (url.search || url.hash) return { ok: false, error: "Leave out query strings and # fragments." };
  if (url.username || url.password) return { ok: false, error: "Don't put credentials in the CDN URL." };
  return { ok: true, value: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

export async function saveStorageSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;

  const errors: Record<string, string> = {};
  const cdn = normalizeCdnBaseUrl(fd(formData, "cdnBaseUrl"));
  if (!cdn.ok) errors.cdnBaseUrl = cdn.error;
  const picked = formData.getAll("renditions").map((v) => Number(v));
  const allowed = new Set<number>(SUPPORTED_RENDITIONS);
  if (!picked.length || picked.some((h) => !allowed.has(h))) errors.renditions = "Pick at least one quality.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  const transcodeToHls = fdBool(formData, "transcodeToHls");
  let wasOn = false;
  const next: Settings["storage"] = {
    cdnBaseUrl: cdn.ok ? cdn.value : undefined,
    transcodeToHls,
    renditions: normalizeRenditions(picked),
    autoTranscribe: fdBool(formData, "autoTranscribe"),
  };
  await mutate((db) => {
    wasOn = db.settings.storage.transcodeToHls;
    db.settings.storage = next;
    db.settings.updatedAt = new Date().toISOString();
  });
  await audit(user, "settings.update", { type: "settings", id: "storage" }, {
    section: "storage",
    transcodeToHls,
    renditions: next.renditions.join("/"),
    autoTranscribe: next.autoTranscribe,
    cdn: next.cdnBaseUrl ?? "",
  });
  // Switching conversion on queues every uploaded video that has no stream yet.
  if (transcodeToHls && !wasOn) after(() => syncAllTranscodes().then(() => undefined));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: transcodeToHls && !wasOn ? "Storage settings saved. Uploaded videos are being queued for conversion." : "Storage settings saved" };
}

export async function testStorageConnectionAction(): Promise<ActionResult<{ driver: "local" | "s3"; steps: ConnectionStep[] }>> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;
  const result = await testStorageConnection();
  const failed = result.steps.find((s) => !s.ok);
  await audit(user, "storage.test", { type: "settings", id: "storage" }, { driver: result.driver, ok: !failed });
  return failed ? { ok: false, error: `The ${failed.step} step failed: ${failed.error ?? "unknown error"}` } : { ok: true, data: result, message: "Storage works: the test file was written, read back and deleted." };
}

export async function recheckFfmpegAction(): Promise<ActionResult<FfmpegStatus>> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;
  const status = await detectFfmpeg(true);
  revalidatePath(SETTINGS_PATH);
  return status.available ? { ok: true, data: status, message: `ffmpeg ${status.ffmpegVersion ?? ""} is ready.`.replace(/\s+/g, " ") } : { ok: false, error: status.error ?? "ffmpeg was not found." };
}

export async function retryTranscodeJobAction(jobId: string): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;
  if (!/^tcj_[a-z0-9]{8,32}$/.test(String(jobId))) return { ok: false, error: "This job no longer exists." };
  const res = await retryTranscodeJob(jobId);
  if (!res.ok) return { ok: false, error: res.message };
  await audit(user, "media.transcode_retry", { type: "transcode_job", id: jobId }, { lessonId: res.job.lessonId });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: undefined, message: "Conversion queued again" };
}

export async function cancelTranscodeJobAction(jobId: string): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;
  if (!/^tcj_[a-z0-9]{8,32}$/.test(String(jobId))) return { ok: false, error: "This job no longer exists." };
  if (!(await cancelTranscodeJob(jobId))) return { ok: false, error: "Only queued or running conversions can be cancelled." };
  await audit(user, "media.transcode_cancel", { type: "transcode_job", id: jobId });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: undefined, message: "Conversion cancelled" };
}

export async function retryFailedTranscodesAction(): Promise<ActionResult<{ queued: number }>> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;
  const queued = await retryFailedTranscodes();
  if (queued) await audit(user, "media.transcode_retry", { type: "transcode_job", id: `${queued} failed` }, { count: queued });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: { queued }, message: queued ? `${queued} ${queued === 1 ? "conversion" : "conversions"} queued again` : "No failed conversions to retry" };
}

export async function convertAllVideosAction(): Promise<ActionResult<{ queued: number }>> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;
  const db = await getDb();
  if (!db.settings.storage.transcodeToHls) return { ok: false, error: "Turn on adaptive streaming first." };
  const queued = await syncAllTranscodes();
  revalidatePath(SETTINGS_PATH);
  return { ok: true, data: { queued }, message: queued ? `${queued} ${queued === 1 ? "video" : "videos"} queued for conversion` : "Every uploaded video is already converted or queued" };
}

export async function runMediaMaintenanceAction(): Promise<ActionResult<MediaMaintenanceResult>> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;
  const result = await runMediaMaintenance();
  revalidatePath(SETTINGS_PATH);
  if (result.errors.length) return { ok: false, error: `Some steps failed: ${result.errors.join("; ")}` };
  return { ok: true, data: result, message: "Housekeeping finished" };
}

export async function migrateLocalFilesAction(): Promise<ActionResult<{ moved: number; more: boolean }>> {
  const user = await requireAdmin();
  if (!user) return NOT_ADMIN;
  const result = await migrateLocalToRemote(500, contentTypeForKey);
  await audit(user, "storage.migrate", { type: "settings", id: "storage" }, { moved: result.moved, failed: result.failed, bytes: result.bytes });
  revalidatePath(SETTINGS_PATH);
  if (result.failed && !result.moved) return { ok: false, error: `No files could be moved. ${result.errors[0] ?? ""}`.trim() };
  const note = result.more ? " More files are left: run it again." : "";
  return { ok: true, data: { moved: result.moved, more: result.more }, message: `${result.moved} ${result.moved === 1 ? "file" : "files"} moved to the bucket.${note}` };
}

/* ------------------------------------------------------------------ */
/* Lesson editor: one video block                                       */
/* ------------------------------------------------------------------ */

async function loadManagedBlock(lessonId: string, blockId: string): Promise<{ user: User } | { error: string }> {
  if (!SAFE_ID.test(String(lessonId)) || !SAFE_ID.test(String(blockId))) return { error: "Invalid lesson or block." };
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in again to continue." };
  const lesson = await findById("lessons", lessonId);
  const course = lesson ? await findById("courses", lesson.courseId) : null;
  if (!lesson || !course) return { error: "This lesson no longer exists." };
  if (!canManageCourse(user, course)) return { error: "You can't manage this course." };
  if (!lesson.blocks.some((b) => b.id === blockId && b.type === "video")) return { error: "Save the lesson first, then convert the video." };
  return { user };
}

/** Convert (or convert again) a video block's upload to HLS. */
export async function transcodeVideoBlockAction(lessonId: string, blockId: string): Promise<ActionResult<BlockMediaStatus>> {
  const loaded = await loadManagedBlock(lessonId, blockId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const res = await enqueueTranscode(lessonId, blockId, { force: true });
  if (!res.ok) return { ok: false, error: res.message };
  await audit(loaded.user, "media.transcode_start", { type: "lesson", id: lessonId }, { blockId });
  const status = await getBlockMediaStatus(loaded.user, lessonId, blockId);
  if (!status.ok) return { ok: false, error: status.error };
  return { ok: true, data: status.status, message: res.created ? "Conversion queued" : "This video is already being converted" };
}

/** Stop the running or queued conversion of a video block. */
export async function cancelVideoBlockTranscodeAction(lessonId: string, blockId: string): Promise<ActionResult<BlockMediaStatus>> {
  const loaded = await loadManagedBlock(lessonId, blockId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const current = await getBlockMediaStatus(loaded.user, lessonId, blockId);
  if (!current.ok) return { ok: false, error: current.error };
  const job = current.status.job;
  if (!job || (job.status !== "queued" && job.status !== "running")) return { ok: false, error: "Nothing is being converted right now." };
  await cancelTranscodeJob(job.id);
  await audit(loaded.user, "media.transcode_cancel", { type: "transcode_job", id: job.id }, { lessonId, blockId });
  const status = await getBlockMediaStatus(loaded.user, lessonId, blockId);
  if (!status.ok) return { ok: false, error: status.error };
  return { ok: true, data: status.status, message: "Conversion cancelled" };
}

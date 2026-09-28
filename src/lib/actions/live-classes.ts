"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Batch, Database, LiveClass, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageBatch } from "@/lib/data/batches";
import { notifyMany } from "@/lib/services/notifications";
import { fd, fdBool, uid } from "@/lib/utils";
import { addMinutesToClock, formatClock12, formatDayKey, isClock, isDateKey, isValidTimeZone } from "@/components/batches/tz";

type Guard = { ok: true; user: User; batch: Batch; db: Database } | { ok: false; error: string };

async function guardBatch(batchId: string): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  if (!canManageBatch(user, batch)) return { ok: false, error: "You are not permitted to manage live classes for this batch." };
  return { ok: true, user, batch, db };
}

async function guardClass(classId: string): Promise<(Guard & { ok: true; liveClass: LiveClass }) | { ok: false; error: string }> {
  const db = await getDb();
  const liveClass = db.liveClasses.find((c) => c.id === classId);
  if (!liveClass) return { ok: false, error: "This live class no longer exists." };
  const guard = await guardBatch(liveClass.batchId);
  if (!guard.ok) return guard;
  return { ...guard, liveClass };
}

function revalidate(batch: Pick<Batch, "id" | "slug">) {
  revalidatePath(`/batches/${batch.slug}`);
  revalidatePath(`/admin/batches/${batch.id}`);
  revalidatePath("/dashboard");
  revalidatePath("/");
}

const PROVIDERS = ["custom", "zoom", "google_meet"] as const;
const RECORDING = ["none", "local", "cloud"] as const;
const BLOCKED_VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i;

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function studentIds(db: Database, batchId: string): string[] {
  return db.batchEnrollments.filter((e) => e.batchId === batchId).map((e) => e.userId);
}

/**
 * Create or update a live class. Conferencing is provider-agnostic: the host
 * pastes the meeting link (Zoom, Google Meet or any custom URL).
 */
export async function saveLiveClassAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const guard = await guardBatch(fd(formData, "batchId"));
  if (!guard.ok) return guard;
  const { user, batch, db } = guard;
  if (!db.settings.features.liveClasses) return { ok: false, error: "Live classes are disabled on this platform." };

  const classId = fd(formData, "classId");
  const existing = classId ? db.liveClasses.find((c) => c.id === classId && c.batchId === batch.id) : null;
  if (classId && !existing) return { ok: false, error: "This live class no longer exists." };

  const title = fd(formData, "title");
  const description = fd(formData, "description");
  const date = fd(formData, "date");
  const time = fd(formData, "time");
  const durationRaw = fd(formData, "durationMinutes");
  const timezone = fd(formData, "timezone");
  const hostId = fd(formData, "hostId");
  const providerRaw = fd(formData, "provider");
  const joinUrl = fd(formData, "joinUrl");
  const startUrl = fd(formData, "startUrl");
  const meetingId = fd(formData, "meetingId");
  const password = fd(formData, "password");
  const recordingRaw = fd(formData, "autoRecording");
  const addToTimetable = fdBool(formData, "addToTimetable");

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Add a title for the class.";
  else if (title.length > 140) fieldErrors.title = "Keep the title under 140 characters.";
  if (description.length > 2000) fieldErrors.description = "Keep the description under 2,000 characters.";
  if (!isDateKey(date)) fieldErrors.date = "Pick the date of the class.";
  if (!isClock(time)) fieldErrors.time = "Time must be in 24 hour format (HH:mm). Example 11:30 or 22:00";
  const durationMinutes = Number(durationRaw);
  if (!durationRaw || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720) {
    fieldErrors.durationMinutes = "Duration must be between 5 and 720 minutes.";
  }
  if (!isValidTimeZone(timezone)) fieldErrors.timezone = "Choose a valid timezone.";
  const host = db.users.find((u) => u.id === hostId && u.enabled);
  if (!host) fieldErrors.hostId = "Choose who will host the class.";
  else if (!host.roles.some((r) => r !== "student") && !batch.instructorIds.includes(host.id)) fieldErrors.hostId = "The host must be an instructor or staff member.";
  const provider = (PROVIDERS as readonly string[]).includes(providerRaw) ? (providerRaw as LiveClass["provider"]) : null;
  if (!provider) fieldErrors.provider = "Choose a conferencing provider.";
  if (!joinUrl) fieldErrors.joinUrl = "Add the meeting link learners will use to join.";
  else if (!isHttpUrl(joinUrl)) fieldErrors.joinUrl = "Enter a full link starting with https://";
  if (startUrl && !isHttpUrl(startUrl)) fieldErrors.startUrl = "Enter a full link starting with https://";
  if (meetingId.length > 80) fieldErrors.meetingId = "Meeting ID is too long.";
  if (password.length > 80) fieldErrors.password = "Passcode is too long.";
  const autoRecording = (RECORDING as readonly string[]).includes(recordingRaw) ? (recordingRaw as LiveClass["autoRecording"]) : "none";
  if (Object.keys(fieldErrors).length) {
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Please fix the errors below.", fieldErrors };
  }

  const values = {
    title,
    description: description || undefined,
    date,
    time,
    durationMinutes,
    timezone,
    hostId,
    provider: provider!,
    joinUrl,
    startUrl: startUrl || undefined,
    meetingId: meetingId || undefined,
    password: password || undefined,
    autoRecording,
  };
  const endTime = addMinutesToClock(time, durationMinutes);
  const link = `/batches/${batch.slug}?tab=classes`;

  if (existing) {
    const rescheduled = existing.date !== date || existing.time !== time || existing.timezone !== timezone;
    await mutate((d) => {
      const row = d.liveClasses.find((c) => c.id === existing.id);
      if (row) Object.assign(row, values);
      const b = d.batches.find((x) => x.id === batch.id);
      if (b) {
        for (const item of b.timetable) {
          if (item.type === "live_class" && item.refId === existing.id) {
            item.title = title;
            item.date = date;
            item.startTime = time;
            item.endTime = endTime;
          }
        }
      }
    });
    if (rescheduled) {
      await notifyMany(studentIds(db, batch.id), {
        type: "live_class",
        subject: `Live class rescheduled: ${title}`,
        message: `Now on ${formatDayKey(date, "long")} at ${formatClock12(time)} (${timezone}).`,
        link,
        fromUserId: user.id,
      });
    }
    revalidate(batch);
    return { ok: true, data: undefined, message: "Live class updated" };
  }

  const liveClass: LiveClass = {
    ...values,
    id: uid("lc"),
    batchId: batch.id,
    attendeeIds: [],
    createdAt: new Date().toISOString(),
  };
  await mutate((d) => {
    d.liveClasses.push(liveClass);
    const b = d.batches.find((x) => x.id === batch.id);
    if (b && addToTimetable && date >= b.startDate && date <= (b.evaluationEndDate && b.evaluationEndDate > b.endDate ? b.evaluationEndDate : b.endDate)) {
      const legend = b.timetableLegends.find((l) => /live/i.test(l.label));
      b.timetable.push({
        id: uid("tt"),
        type: "live_class",
        refId: liveClass.id,
        title,
        date,
        startTime: time,
        endTime,
        milestone: false,
        legendId: legend?.id,
      });
      b.timetable.sort((x, y) => `${x.date} ${x.startTime ?? ""}`.localeCompare(`${y.date} ${y.startTime ?? ""}`));
    }
  });
  await notifyMany(studentIds(db, batch.id), {
    type: "live_class",
    subject: `New live class: ${title}`,
    message: `${formatDayKey(date, "long")} at ${formatClock12(time)} (${timezone}) · ${batch.title}`,
    link,
    fromUserId: user.id,
  });
  revalidate(batch);
  return { ok: true, data: undefined, message: "Live class scheduled" };
}

export async function deleteLiveClassAction(classId: string): Promise<ActionResult> {
  const guard = await guardClass(classId);
  if (!guard.ok) return guard;
  const { batch, liveClass } = guard;
  await mutate((d) => {
    d.liveClasses = d.liveClasses.filter((c) => c.id !== liveClass.id);
    const b = d.batches.find((x) => x.id === batch.id);
    if (b) b.timetable = b.timetable.filter((t) => !(t.type === "live_class" && t.refId === liveClass.id));
  });
  revalidate(batch);
  return { ok: true, data: undefined, message: "Live class deleted" };
}

/** Record which enrolled students attended a class. */
export async function saveAttendanceAction(classId: string, attendeeIds: string[]): Promise<ActionResult> {
  const guard = await guardClass(classId);
  if (!guard.ok) return guard;
  const { batch, db, liveClass } = guard;
  if (!Array.isArray(attendeeIds)) return { ok: false, error: "Invalid attendance list." };
  const enrolled = new Set(studentIds(db, batch.id));
  const clean = Array.from(new Set(attendeeIds.filter((id) => typeof id === "string" && enrolled.has(id))));
  await mutate((d) => {
    const row = d.liveClasses.find((c) => c.id === liveClass.id);
    if (row) row.attendeeIds = clean;
  });
  revalidate(batch);
  return { ok: true, data: undefined, message: `Attendance saved (${clean.length} present)` };
}

/**
 * Attach (or remove, with an empty url) the self-hosted recording of a class.
 * Only direct video files are accepted — never YouTube/Vimeo pages.
 */
export async function saveRecordingAction(classId: string, url: string): Promise<ActionResult> {
  const guard = await guardClass(classId);
  if (!guard.ok) return guard;
  const { batch, db, liveClass, user } = guard;
  const value = (url ?? "").trim();
  if (value) {
    const local = value.startsWith("/uploads/");
    if (!local) {
      if (!isHttpUrl(value)) return { ok: false, error: "Upload a video or paste a direct link to a video file." };
      const host = new URL(value).hostname;
      if (BLOCKED_VIDEO_HOSTS.test(host)) return { ok: false, error: "YouTube and Vimeo links are not supported. Upload the video file instead." };
    }
    if (!/\.(mp4|webm|ogv|ogg|mov|m4v)(\?|#|$)/i.test(value)) return { ok: false, error: "The recording must be a video file (.mp4, .webm, .ogg or .mov)." };
  }
  const hadRecording = !!liveClass.recordingUrl;
  await mutate((d) => {
    const row = d.liveClasses.find((c) => c.id === liveClass.id);
    if (row) row.recordingUrl = value || undefined;
  });
  if (value && !hadRecording) {
    await notifyMany(studentIds(db, batch.id), {
      type: "live_class",
      subject: `Recording available: ${liveClass.title}`,
      message: batch.title,
      link: `/batches/${batch.slug}?tab=classes#class-${liveClass.id}`,
      fromUserId: user.id,
    });
  }
  revalidate(batch);
  return { ok: true, data: undefined, message: value ? "Recording saved" : "Recording removed" };
}

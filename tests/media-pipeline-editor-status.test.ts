import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { Lesson, LessonBlock, TranscodeJob, User } from "@/lib/types";
import type { BlockMediaStatus } from "@/lib/media/transcode/status";
import type { SettingsPatch } from "./helpers/db";

/**
 * Lesson editor conversion panel and Settings → Storage & video queue:
 * the pure view models (`describeMediaStatus`, `queuePage`), the
 * `GET /api/media/status` route and the editor's convert/cancel actions.
 */

const missing = path.join(tmpdir(), "ll-no-ffmpeg-editor");
process.env.FFMPEG_PATH = path.join(missing, "ffmpeg");
process.env.FFPROBE_PATH = path.join(missing, "ffprobe");

const { makeCourse, makeLesson, makeUser, resetDb } = await import("./helpers/db");
const { resetRequest } = await import("./helpers/request");
const { createSession } = await import("@/lib/auth/session");
const { getDb } = await import("@/lib/db/store");
const { describeMediaStatus, formatBitrate, POLL_IDLE_MS, POLL_QUEUED_MS, POLL_RUNNING_MS } = await import("@/lib/media/transcode/status-view");
const { errorSummary, parsePage, parseQueueFilter, queuePage } = await import("@/lib/media/transcode/overview");
const { GET: statusGET } = await import("@/app/api/media/status/route");
const actions = await import("@/lib/actions/storage-settings");
await import("@/lib/media/transcode/queue");

const g = globalThis as unknown as {
  __llFfmpeg: { status?: Record<string, unknown> };
  __llTranscodeWorker: { running: boolean };
};

function setFfmpeg(available: boolean): void {
  g.__llFfmpeg.status = {
    available,
    ffmpegPath: process.env.FFMPEG_PATH,
    ffprobePath: process.env.FFPROBE_PATH,
    ffmpegVersion: available ? "7.1" : null,
    ffprobeVersion: available ? "7.1" : null,
    error: available ? null : "ffmpeg was not found",
    checkedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* describeMediaStatus                                                  */
/* ------------------------------------------------------------------ */

const SRC = "/uploads/videos/lecture.mp4";

function status(overrides: Partial<BlockMediaStatus> = {}): BlockMediaStatus {
  return {
    lessonId: "les_e",
    blockId: "blk_e",
    courseId: "crs_e",
    enabled: true,
    ffmpeg: { available: true, error: null, hint: null },
    convertible: true,
    saved: true,
    savedSrc: SRC,
    transcode: null,
    hlsReady: false,
    job: null,
    configuredRenditions: [1080, 720, 480],
    transcriptId: null,
    transcriptHref: "/admin/courses/crs_e/lessons/les_e/transcript?block=blk_e",
    editHref: "/admin/courses/crs_e/lessons/les_e",
    ...overrides,
  };
}

function jobView(overrides: Partial<NonNullable<BlockMediaStatus["job"]>> = {}): NonNullable<BlockMediaStatus["job"]> {
  return {
    id: "tcj_abcdefgh",
    status: "running",
    progress: 42,
    attempts: 1,
    error: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    startedAt: "2026-09-01T10:00:01.000Z",
    finishedAt: null,
    queuePosition: null,
    heights: [1080, 720, 480],
    speed: 1.4,
    ...overrides,
  };
}

describe("describeMediaStatus", () => {
  it("asks for a video, then for a save", () => {
    assert.equal(describeMediaStatus(null, "").title, "Add a video");
    const unsaved = describeMediaStatus(null, SRC);
    assert.equal(unsaved.title, "Not saved yet");
    assert.equal(unsaved.pollMs, POLL_IDLE_MS);
    assert.equal(describeMediaStatus(status({ saved: false, savedSrc: null }), SRC).title, "Not saved yet");
    const changed = describeMediaStatus(status(), "/uploads/videos/other.mp4");
    assert.equal(changed.title, "New video not saved");
    assert.equal(changed.convert, null);
  });

  it("explains that linked videos are not converted, without polling", () => {
    const v = describeMediaStatus(status({ convertible: false, savedSrc: "https://cdn.example.com/a.mp4" }), "https://cdn.example.com/a.mp4");
    assert.equal(v.title, "Plays as linked");
    assert.equal(v.pollMs, null);
    assert.equal(v.convert, null);
  });

  it("shows progress with the renditions being made", () => {
    const v = describeMediaStatus(status({ job: jobView() }), SRC);
    assert.equal(v.title, "Processing 42% (1080p/720p/480p)");
    assert.equal(v.progress, 42);
    assert.equal(v.tone, "info");
    assert.equal(v.cancel, true);
    assert.equal(v.pollMs, POLL_RUNNING_MS);
  });

  it("falls back to the configured renditions and clamps progress", () => {
    const v = describeMediaStatus(status({ job: jobView({ heights: null, progress: 140.6 }), configuredRenditions: [720, 480] }), SRC);
    assert.equal(v.title, "Processing 100% (720p/480p)");
    assert.equal(v.progress, 100);
  });

  it("shows the queue position", () => {
    const later = describeMediaStatus(status({ job: jobView({ status: "queued", progress: 0, queuePosition: 3, heights: null }) }), SRC);
    assert.equal(later.title, "Queued (number 3 in line)");
    assert.equal(later.pollMs, POLL_QUEUED_MS);
    assert.equal(later.cancel, true);
    const next = describeMediaStatus(status({ job: jobView({ status: "queued", progress: 0, queuePosition: 1, heights: null }) }), SRC);
    assert.equal(next.title, "Queued, starting soon");
  });

  it("reports Ready with renditions highest first and offers Convert again", () => {
    const v = describeMediaStatus(
      status({
        hlsReady: true,
        transcode: { status: "ready", updatedAt: "x", renditions: [{ height: 480, bandwidth: 1_400_000 }, { height: 1080, bandwidth: 5_100_000 }] },
        job: jobView({ status: "done", progress: 100 }),
      }),
      SRC,
    );
    assert.equal(v.title, "Ready");
    assert.equal(v.tone, "success");
    assert.deepEqual(v.renditions.map((r) => r.label), ["1080p", "480p"]);
    assert.equal(v.convert, "again");
    assert.equal(v.pollMs, null);
    assert.match(v.detail ?? "", /1080p\/480p/);
  });

  it("reports Failed with the first error line and Retry", () => {
    const v = describeMediaStatus(status({ job: jobView({ status: "failed", error: "ffmpeg exited with code 1\nframe=  12 fps=0.0\nInvalid data found" }) }), SRC);
    assert.equal(v.title, "Failed");
    assert.equal(v.tone, "danger");
    assert.equal(v.convert, "retry");
    assert.equal(v.detail, "ffmpeg exited with code 1. Learners get the original file.");
    const withStream = describeMediaStatus(status({ hlsReady: true, transcode: { status: "failed", error: "Cancelled by an administrator.", updatedAt: "x" } }), SRC);
    assert.equal(withStream.detail, "Cancelled by an administrator. The previous stream keeps playing.");
  });

  it("notes a missing converter and a disabled setting", () => {
    const noFfmpeg = describeMediaStatus(status({ ffmpeg: { available: false, error: "ffmpeg was not found", hint: "Install it." } }), SRC);
    assert.equal(noFfmpeg.title, "Converter not installed");
    assert.equal(noFfmpeg.tone, "warning");
    assert.match(noFfmpeg.detail ?? "", /Install it\./);
    assert.equal(noFfmpeg.convert, null);
    const off = describeMediaStatus(status({ enabled: false }), SRC);
    assert.equal(off.title, "Adaptive streaming is off");
    const offReady = describeMediaStatus(status({ enabled: false, hlsReady: true }), SRC);
    assert.equal(offReady.title, "Ready");
  });

  it("waits for a pending conversion", () => {
    const v = describeMediaStatus(status({ transcode: { status: "pending", updatedAt: "x" } }), SRC);
    assert.equal(v.title, "Waiting to convert");
    assert.equal(v.pollMs, POLL_QUEUED_MS);
  });

  it("formats bit rates", () => {
    assert.equal(formatBitrate(2_800_000), "2.8 Mbit/s");
    assert.equal(formatBitrate(12_400_000), "12 Mbit/s");
    assert.equal(formatBitrate(850_000), "850 kbit/s");
    assert.equal(formatBitrate(0), "");
    assert.equal(formatBitrate(Number.NaN), "");
  });
});

/* ------------------------------------------------------------------ */
/* queuePage                                                            */
/* ------------------------------------------------------------------ */

describe("queuePage", () => {
  const course = makeCourse({ id: "crs_q", title: "Video Editing" });
  const lessonA = makeLesson({ id: "les_a", courseId: course.id, chapterId: "chp", title: "Color grading" });
  const lessonB = makeLesson({ id: "les_b", courseId: course.id, chapterId: "chp", title: "Audio cleanup" });
  const j = (id: string, o: Partial<TranscodeJob>): TranscodeJob => ({ id, lessonId: "les_a", blockId: "b", sourceKey: `videos/${id}.mp4`, status: "done", progress: 100, attempts: 1, createdAt: "2026-09-01T00:00:00.000Z", ...o });
  const jobs = [
    j("done_old", { finishedAt: "2026-09-02T00:00:00.000Z" }),
    j("done_new", { finishedAt: "2026-09-05T00:00:00.000Z", lessonId: "les_b" }),
    j("queued_2", { status: "queued", progress: 0, createdAt: "2026-09-04T00:00:00.000Z" }),
    j("queued_1", { status: "queued", progress: 0, createdAt: "2026-09-03T00:00:00.000Z" }),
    j("running", { status: "running", progress: 30 }),
    j("failed", { status: "failed", error: "boom", finishedAt: "2026-09-04T00:00:00.000Z", lessonId: "les_gone" }),
  ];
  const db = { transcodeJobs: jobs, lessons: [lessonA, lessonB], courses: [course] };

  it("orders running, queued (oldest first), then the rest newest first", () => {
    const page = queuePage(db, { filter: "all" });
    assert.deepEqual(page.rows.map((r) => r.job.id), ["running", "queued_1", "queued_2", "done_new", "failed", "done_old"]);
    assert.deepEqual(page.counts, { all: 6, queued: 2, running: 1, failed: 1, done: 2 });
  });

  it("filters by status, searches titles and links lessons", () => {
    const failed = queuePage(db, { filter: "failed" });
    assert.equal(failed.total, 1);
    assert.equal(failed.rows[0]!.editHref, null);
    assert.equal(failed.rows[0]!.lessonTitle, null);
    const audio = queuePage(db, { filter: "all", query: "  AUDIO " });
    assert.deepEqual(audio.rows.map((r) => r.job.id), ["done_new"]);
    assert.equal(audio.rows[0]!.editHref, "/admin/courses/crs_q/lessons/les_b");
    assert.equal(audio.rows[0]!.courseTitle, "Video Editing");
    assert.equal(queuePage(db, { filter: "all", query: "queued_2.mp4" }).total, 1);
  });

  it("paginates and clamps the page", () => {
    const p2 = queuePage(db, { filter: "all", page: 2, pageSize: 4 });
    assert.equal(p2.pages, 2);
    assert.equal(p2.page, 2);
    assert.deepEqual(p2.rows.map((r) => r.job.id), ["failed", "done_old"]);
    assert.equal(queuePage(db, { filter: "all", page: 99, pageSize: 4 }).page, 2);
    assert.equal(queuePage({ ...db, transcodeJobs: [] }, { filter: "all" }).pages, 1);
  });

  it("parses query parameters defensively", () => {
    assert.equal(parseQueueFilter("failed"), "failed");
    assert.equal(parseQueueFilter(["running", "done"]), "running");
    assert.equal(parseQueueFilter("bogus"), "all");
    assert.equal(parseQueueFilter(undefined), "all");
    assert.equal(parsePage("3"), 3);
    assert.equal(parsePage("-1"), 1);
    assert.equal(parsePage("abc"), 1);
    assert.equal(parsePage("99999999"), 10_000);
  });

  it("summarizes errors by their first line", () => {
    assert.equal(errorSummary("ffmpeg exited with code 1\nstderr tail"), "ffmpeg exited with code 1");
    assert.equal(errorSummary("\n\n  second  \n"), "second");
    assert.equal(errorSummary(undefined), "");
    assert.equal(errorSummary("x".repeat(200), 10), `${"x".repeat(9)}…`);
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/media/status + editor actions                               */
/* ------------------------------------------------------------------ */

describe("media status route and editor actions", () => {
  const instructor = makeUser({ id: "usr_ed_instr", roles: ["course_creator"] });
  const outsider = makeUser({ id: "usr_ed_out", roles: ["course_creator"] });
  const course = makeCourse({ id: "crs_ed", instructorIds: [instructor.id], createdById: instructor.id });
  const video = (id: string, src = SRC): LessonBlock => ({ id, type: "video", src });
  const lesson = (blocks: LessonBlock[]): Lesson => makeLesson({ id: "les_ed", courseId: course.id, chapterId: "chp_ed", blocks });

  async function seed(blocks: LessonBlock[], settings: SettingsPatch = {}, jobs: TranscodeJob[] = []) {
    await resetDb({ users: [instructor, outsider], courses: [course], lessons: [lesson(blocks)], transcodeJobs: jobs, settings });
  }

  async function as(user: User | null) {
    resetRequest();
    if (user) await createSession(user.id);
  }

  async function get(query: string) {
    const url = new URL(`/api/media/status?${query}`, "https://lms.test");
    const res = await statusGET(Object.assign(new Request(url), { nextUrl: url }) as unknown as NextRequest);
    return { res, body: (await res.json()) as { ok: boolean; status?: BlockMediaStatus; error?: string } };
  }

  beforeEach(() => {
    g.__llTranscodeWorker.running = true; // keep the real worker idle
    setFfmpeg(true);
    mock.method(console, "error", () => undefined);
  });
  afterEach(() => mock.restoreAll());

  it("validates input and requires a course manager", async () => {
    await seed([video("blk_ed")]);
    await as(instructor);
    assert.equal((await get("")).res.status, 400);
    assert.equal((await get("blockId=../x")).res.status, 400);
    await as(null);
    assert.equal((await get("blockId=blk_ed")).res.status, 401);
    await as(outsider);
    const denied = await get("blockId=blk_ed&lessonId=les_ed");
    assert.equal(denied.res.status, 403);
    assert.equal(denied.res.headers.get("Cache-Control"), "private, no-store");
  });

  it("reports unsaved and unknown blocks", async () => {
    await seed([video("blk_ed")]);
    await as(instructor);
    const unsaved = await get("blockId=blk_new&lessonId=les_ed");
    assert.equal(unsaved.res.status, 200);
    assert.equal(unsaved.body.status?.saved, false);
    assert.equal(unsaved.body.status?.transcriptHref, "/admin/courses/crs_ed/lessons/les_ed/transcript?block=blk_new");
    assert.equal((await get("blockId=blk_new")).res.status, 404);
  });

  it("queues a saved upload on the first poll and shows the job", async () => {
    await seed([video("blk_ed")], { storage: { transcodeToHls: true, renditions: [720, 480], autoTranscribe: false } });
    await as(instructor);
    const { res, body } = await get("blockId=blk_ed&lessonId=les_ed");
    assert.equal(res.status, 200);
    const s = body.status!;
    assert.equal(s.saved, true);
    assert.equal(s.convertible, true);
    assert.equal(s.savedSrc, SRC);
    assert.equal(s.job?.status, "queued");
    assert.equal(s.job?.queuePosition, 1);
    assert.deepEqual(s.configuredRenditions, [720, 480]);
    assert.equal(describeMediaStatus(s, SRC).title, "Queued, starting soon");
    assert.equal((await getDb()).transcodeJobs.length, 1);
    // Polling again does not queue twice.
    await get("blockId=blk_ed&lessonId=les_ed");
    assert.equal((await getDb()).transcodeJobs.length, 1);
  });

  it("does not queue while adaptive streaming is off, and leaves links alone", async () => {
    await seed([video("blk_ed"), video("blk_link", "https://cdn.example.com/a.mp4")], { storage: { transcodeToHls: false, renditions: [720], autoTranscribe: false } });
    await as(instructor);
    const off = await get("blockId=blk_ed&lessonId=les_ed");
    assert.equal(off.body.status?.enabled, false);
    assert.equal(off.body.status?.job, null);
    const link = await get("blockId=blk_link");
    assert.equal(link.body.status?.convertible, false);
    assert.equal((await getDb()).transcodeJobs.length, 0);
  });

  it("converts again and cancels from the editor", async () => {
    await seed([video("blk_ed")], { storage: { transcodeToHls: true, renditions: [720], autoTranscribe: false } });
    await as(outsider);
    assert.equal((await actions.transcodeVideoBlockAction("les_ed", "blk_ed")).ok, false);
    await as(instructor);
    const unsaved = await actions.transcodeVideoBlockAction("les_ed", "blk_unsaved");
    assert.equal(!unsaved.ok && unsaved.error, "Save the lesson first, then convert the video.");
    const started = await actions.transcodeVideoBlockAction("les_ed", "blk_ed");
    assert.ok(started.ok);
    assert.equal(started.data.job?.status, "queued");
    const cancelled = await actions.cancelVideoBlockTranscodeAction("les_ed", "blk_ed");
    assert.ok(cancelled.ok);
    assert.equal(cancelled.data.job?.status, "failed");
    assert.equal(describeMediaStatus(cancelled.data, SRC).convert, "retry");
    const nothing = await actions.cancelVideoBlockTranscodeAction("les_ed", "blk_ed");
    assert.equal(nothing.ok, false);
    const db = await getDb();
    assert.ok(db.auditEvents.some((e) => e.action === "media.transcode_start"));
  });

  it("only lets administrators change storage settings", async () => {
    await seed([video("blk_ed")]);
    await as(instructor);
    const fd = new FormData();
    fd.set("transcodeToHls", "on");
    fd.append("renditions", "720");
    assert.equal((await actions.saveStorageSettingsAction(null, fd)).ok, false);
    assert.equal((await actions.retryFailedTranscodesAction()).ok, false);
    assert.equal((await actions.testStorageConnectionAction()).ok, false);
  });

  it("validates and saves storage settings as an administrator", async () => {
    const admin = makeUser({ id: "usr_ed_admin", roles: ["admin"] });
    await resetDb({ users: [admin], courses: [course], lessons: [lesson([video("blk_ed")])], settings: { storage: { transcodeToHls: false, renditions: [720], autoTranscribe: false } } });
    await as(admin);
    const bad = new FormData();
    bad.set("cdnBaseUrl", "ftp://cdn.example.com");
    bad.append("renditions", "999");
    const rejected = await actions.saveStorageSettingsAction(null, bad);
    assert.equal(rejected.ok, false);
    assert.ok(!rejected.ok && rejected.fieldErrors?.cdnBaseUrl && rejected.fieldErrors.renditions);

    const good = new FormData();
    good.set("cdnBaseUrl", " https://cdn.example.com/media/ ");
    good.append("renditions", "480");
    good.append("renditions", "1080");
    good.set("autoTranscribe", "on");
    const saved = await actions.saveStorageSettingsAction(null, good);
    assert.ok(saved.ok);
    const s = (await getDb()).settings.storage;
    assert.equal(s.cdnBaseUrl, "https://cdn.example.com/media");
    assert.deepEqual(s.renditions, [1080, 480]);
    assert.equal(s.transcodeToHls, false);
    assert.equal(s.autoTranscribe, true);
  });
});

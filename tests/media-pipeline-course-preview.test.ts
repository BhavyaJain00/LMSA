import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { Course, TranscodeJob, User } from "@/lib/types";
import type { CoursePreviewMediaStatus } from "@/lib/media/transcode/status";
import type { SettingsPatch } from "./helpers/db";

/**
 * Adaptive streaming of course preview videos (`Course.videoUrl`): the
 * "course-preview" transcode target (storage keys, job identity, planning,
 * releasing output of a replaced video), the queue and worker for it, the
 * `GET /api/media/status?courseId=` route and course settings actions, the
 * conversion panel wording, playback authorization and the course page's
 * player sources.
 *
 * ffmpeg is never run: the binaries point at a missing path and the
 * detection cache is primed per test. The worker is held idle unless a test
 * releases it.
 */

const missing = path.join(tmpdir(), "ll-no-ffmpeg-course-preview");
process.env.FFMPEG_PATH = path.join(missing, "ffmpeg");
process.env.FFPROBE_PATH = path.join(missing, "ffprobe");

const { makeCourse, makeLesson, makeUser, resetDb } = await import("./helpers/db");
const { resetRequest } = await import("./helpers/request");
const { createSession } = await import("@/lib/auth/session");
const { getDb } = await import("@/lib/db/store");
const { uploadRoot } = await import("@/lib/storage");
const targets = await import("@/lib/media/transcode/targets");
const { HLS_VERSION_FOLDER, hlsKeyPrefix, hlsVersionPrefix } = await import("@/lib/media/transcode/lesson-fields");
const { describeMediaStatus } = await import("@/lib/media/transcode/status-view");
const { COURSE_PREVIEW_ROW_TITLE, queuePage } = await import("@/lib/media/transcode/overview");
const { courseReferencesPath, authorizeMediaAccess } = await import("@/lib/media/access");
const { coursePreviewPlayback } = await import("@/lib/media/course-preview");
const queue = await import("@/lib/media/transcode/queue");
const actions = await import("@/lib/actions/storage-settings");
const { GET: statusGET } = await import("@/app/api/media/status/route");

const g = globalThis as unknown as {
  __llFfmpeg: { status?: Record<string, unknown> };
  __llTranscodeWorker: { running: boolean; current: unknown };
};

function setFfmpeg(available: boolean): void {
  g.__llFfmpeg.status = {
    available,
    ffmpegPath: process.env.FFMPEG_PATH,
    ffprobePath: process.env.FFPROBE_PATH,
    ffmpegVersion: available ? "7.1" : null,
    ffprobeVersion: available ? "7.1" : null,
    error: available ? null : "ffmpeg was not found; ffprobe was not found",
    checkedAt: new Date().toISOString(),
  };
}

function holdWorker(): void {
  g.__llTranscodeWorker.running = true;
}

async function runWorker(): Promise<void> {
  g.__llTranscodeWorker.running = false;
  queue.kickTranscodeWorker();
  const until = Date.now() + 15_000;
  while (queue.isWorkerRunning()) {
    if (Date.now() > until) throw new Error("The transcode worker did not finish.");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const SRC = "/uploads/videos/intro.mp4";
const KEY = "videos/intro.mp4";
const NEW_SRC = "/uploads/videos/intro-v2.mp4";
const NEW_KEY = "videos/intro-v2.mp4";
const HLS = "/uploads/videos/course/crs_cp/preview/hls/v1/master.m3u8";
const POSTER = "/uploads/posters/course/crs_cp/preview-v1.jpg";
const target = targets.coursePreviewTarget("crs_cp");

function job(overrides: Partial<TranscodeJob> & Pick<TranscodeJob, "id">): TranscodeJob {
  return {
    target: { kind: "course-preview", courseId: "crs_cp" },
    lessonId: "",
    blockId: "",
    sourceKey: KEY,
    status: "queued",
    progress: 0,
    attempts: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Pure target helpers                                                  */
/* ------------------------------------------------------------------ */

describe("course preview target: storage keys", () => {
  it("stores HLS output under videos/course/<courseId>/preview/hls/", () => {
    assert.equal(targets.coursePreviewKeyPrefix("crs_cp"), "videos/course/crs_cp/preview/hls/");
    assert.equal(targets.hlsPrefixFor(target), "videos/course/crs_cp/preview/hls/");
    assert.equal(targets.hlsPrefixFor(targets.lessonBlockTarget("les_1", "blk_1")), hlsKeyPrefix("les_1", "blk_1"));
  });

  it("names poster frames per version and target", () => {
    assert.equal(targets.posterKeyFor(target, "v1"), "posters/course/crs_cp/preview-v1.jpg");
    assert.equal(targets.posterKeyFor(targets.lessonBlockTarget("les_1", "blk_1"), "v2"), "posters/les_1/blk_1-v2.jpg");
  });

  it("refuses ids that are not safe path segments", () => {
    assert.throws(() => targets.coursePreviewKeyPrefix("../etc"));
    assert.throws(() => targets.coursePreviewKeyPrefix(""));
    assert.throws(() => targets.hlsPrefixFor(targets.coursePreviewTarget("a/b")));
    assert.throws(() => targets.posterKeyFor(target, "v/1"));
    assert.throws(() => targets.posterKeyFor(targets.coursePreviewTarget("x y"), "v1"));
  });

  it("recognizes course preview HLS version folders", () => {
    assert.equal(HLS_VERSION_FOLDER.exec("videos/course/crs_cp/preview/hls/v1/720p/seg_00001.m4s")?.[1], "videos/course/crs_cp/preview/hls/v1/");
    assert.equal(hlsVersionPrefix(HLS), "videos/course/crs_cp/preview/hls/v1/");
    assert.equal(hlsVersionPrefix("https://lms.test/uploads/videos/course/crs_cp/preview/hls/v9/master.m3u8", ["https://lms.test"]), "videos/course/crs_cp/preview/hls/v9/");
    assert.equal(hlsVersionPrefix("/uploads/videos/intro.mp4"), null);
  });

  it("collects HLS versions referenced by lesson blocks and course previews", () => {
    const refs = targets.referencedHlsVersions({
      lessons: [makeLesson({ id: "les_r", courseId: "crs_cp", chapterId: "chp_r", blocks: [{ id: "blk_r", type: "video", src: SRC, hlsUrl: "/uploads/videos/les_r/blk_r/hls/a/master.m3u8" }] })],
      courses: [makeCourse({ id: "crs_cp", videoUrl: SRC, previewHlsUrl: HLS })],
    });
    assert.deepEqual([...refs].sort(), ["videos/course/crs_cp/preview/hls/v1/", "videos/les_r/blk_r/hls/a/"]);
  });
});

describe("course preview target: job identity", () => {
  it("gives new jobs a target and empty lesson ids", () => {
    assert.deepEqual(targets.jobIdentity(target), { target: { kind: "course-preview", courseId: "crs_cp" }, lessonId: "", blockId: "" });
    assert.deepEqual(targets.jobIdentity(targets.lessonBlockTarget("les_1", "blk_1")), {
      target: { kind: "lesson-block", lessonId: "les_1", blockId: "blk_1" },
      lessonId: "les_1",
      blockId: "blk_1",
    });
  });

  it("reads jobs queued before targets existed as lesson block jobs", () => {
    const legacy = { lessonId: "les_old", blockId: "blk_old" };
    assert.deepEqual(targets.jobTarget(legacy), { kind: "lesson-block", lessonId: "les_old", blockId: "blk_old" });
    assert.equal(targets.jobTargetId(legacy), "lesson:les_old/blk_old");
    assert.equal(targets.jobTargetId(job({ id: "j" })), "course:crs_cp");
    assert.ok(targets.isJobFor(job({ id: "j" }), target));
    assert.ok(!targets.isJobFor(job({ id: "j" }), targets.coursePreviewTarget("crs_other")));
  });

  it("finds the newest job of a target", () => {
    const jobs = [
      job({ id: "a", createdAt: "2026-09-01T10:00:00.000Z" }),
      job({ id: "b", createdAt: "2026-09-02T10:00:00.000Z" }),
      job({ id: "c", createdAt: "2026-09-03T10:00:00.000Z", target: { kind: "course-preview", courseId: "crs_other" } }),
    ];
    assert.equal(targets.latestJobForTarget(jobs, target)?.id, "b");
    assert.equal(targets.latestJobForTarget([], target), null);
  });
});

describe("course preview target: reading and patching fields", () => {
  it("maps the media view onto the course's preview fields", () => {
    const db = { lessons: [], courses: [makeCourse({ id: "crs_cp", videoUrl: SRC, previewHlsUrl: HLS, previewStorageKey: KEY, previewPosterUrl: POSTER })] };
    assert.deepEqual(targets.readTargetMedia(db, target), { src: SRC, hlsUrl: HLS, storageKey: KEY, transcode: undefined, posterUrl: POSTER });
    assert.equal(targets.readTargetMedia(db, targets.coursePreviewTarget("crs_gone")), null);

    assert.ok(targets.patchTargetMedia(db, target, () => ({ hlsUrl: undefined, transcode: { status: "pending", progress: 0, updatedAt: "now" }, duration: 99 })));
    const course = db.courses[0]!;
    assert.equal(course.previewHlsUrl, undefined);
    assert.ok(!("previewHlsUrl" in course), "an undefined patch value removes the field");
    assert.equal(course.previewTranscode?.status, "pending");
    assert.equal((course as unknown as Record<string, unknown>).duration, undefined, "courses have no duration field");
    assert.equal(course.videoUrl, SRC, "the source is never patched");
    assert.equal(targets.patchTargetMedia(db, target, () => null), false);
  });

  it("plays the stream only while it belongs to the current upload", () => {
    const course = { videoUrl: SRC, previewHlsUrl: HLS, previewStorageKey: KEY };
    assert.equal(targets.coursePreviewHlsUrl(course), HLS);
    assert.equal(targets.coursePreviewHlsUrl({ ...course, videoUrl: NEW_SRC }), undefined);
    assert.equal(targets.coursePreviewHlsUrl({ ...course, previewStorageKey: undefined }), undefined);
    assert.equal(targets.coursePreviewHlsUrl({ ...course, videoUrl: "https://cdn.example.com/a.mp4" }), undefined);
    assert.equal(targets.coursePreviewSourceKey({ videoUrl: SRC }), KEY);
    assert.equal(targets.coursePreviewSourceKey({ videoUrl: "/uploads/images/a.png" }), null);
  });
});

describe("course preview target: planning a job", () => {
  const media = (extra: Partial<ReturnType<typeof targets.readTargetMedia> & object> = {}) => ({ src: SRC, ...extra });

  it("refuses a missing course and linked videos", () => {
    const gone = targets.planEnqueue({ target, media: null, jobs: [], ffmpegAvailable: true });
    assert.deepEqual(gone, { action: "refuse", reason: "not-found", message: "This course no longer exists." });
    const link = targets.planEnqueue({ target, media: media({ src: "https://cdn.example.com/a.mp4" }), jobs: [], ffmpegAvailable: true });
    assert.equal(link.action, "refuse");
  });

  it("marks the preview unavailable without ffmpeg (the MP4 keeps playing)", () => {
    const plan = targets.planEnqueue({ target, media: media(), jobs: [], ffmpegAvailable: false });
    assert.deepEqual(plan, { action: "unavailable", sourceKey: KEY, stale: false, message: targets.UNAVAILABLE_MESSAGE });
  });

  it("creates a job and makes queued jobs for an older file obsolete", () => {
    const jobs = [job({ id: "old", sourceKey: "videos/old.mp4" }), job({ id: "other", target: { kind: "course-preview", courseId: "crs_x" }, sourceKey: "videos/old.mp4" })];
    const plan = targets.planEnqueue({ target, media: media({ hlsUrl: HLS, storageKey: "videos/old.mp4" }), jobs, ffmpegAvailable: true });
    assert.deepEqual(plan, { action: "create", sourceKey: KEY, stale: true, obsoleteJobIds: ["old"] });
  });

  it("reuses an active job and skips ready or failed files unless forced", () => {
    const active = job({ id: "run", status: "running" });
    assert.deepEqual(targets.planEnqueue({ target, media: media(), jobs: [active], ffmpegAvailable: true }), { action: "reuse", job: active });

    const ready = media({ hlsUrl: HLS, storageKey: KEY, transcode: { status: "ready", progress: 100, updatedAt: "t" } });
    assert.equal(targets.planEnqueue({ target, media: ready, jobs: [], ffmpegAvailable: true }).action, "skip");
    assert.equal(targets.planEnqueue({ target, media: ready, jobs: [], ffmpegAvailable: true, force: true }).action, "create");

    const failed = [job({ id: "f", status: "failed", error: "ffprobe could not read the video.\nstderr" })];
    const skip = targets.planEnqueue({ target, media: media(), jobs: failed, ffmpegAvailable: true });
    assert.deepEqual(skip, { action: "skip", reason: "failed", message: "ffprobe could not read the video." });
    assert.equal(targets.planEnqueue({ target, media: media(), jobs: failed, ffmpegAvailable: true, force: true }).action, "create");
  });

  it("knows when a preview still needs a conversion", () => {
    assert.ok(targets.needsConversion({ src: SRC }));
    assert.ok(!targets.needsConversion({ src: SRC, hlsUrl: HLS, storageKey: KEY, transcode: { status: "ready", updatedAt: "t" } }));
    assert.ok(targets.needsConversion({ src: NEW_SRC, hlsUrl: HLS, storageKey: KEY, transcode: { status: "ready", updatedAt: "t" } }));
    assert.ok(!targets.needsConversion({ src: "https://cdn.example.com/a.mp4" }));
    assert.ok(!targets.needsConversion(null));
  });
});

describe("course preview target: releasing output of a replaced video", () => {
  const ready = { status: "ready" as const, progress: 100, updatedAt: "t" };

  it("leaves output that belongs to the current file alone", () => {
    const plan = targets.planStaleOutputRelease({ target, media: { src: SRC, hlsUrl: HLS, storageKey: KEY, transcode: ready, posterUrl: POSTER }, jobs: [] });
    assert.deepEqual(plan, { patch: null, releasedVersion: null, releasedPoster: null, obsoleteJobIds: [], abortJobId: null });
    assert.equal(targets.planStaleOutputRelease({ target, media: null, jobs: [] }).patch, null);
  });

  it("releases the stream and generated poster of a replaced upload", () => {
    const jobs = [job({ id: "q_old", sourceKey: KEY }), job({ id: "r_old", status: "running", sourceKey: KEY }), job({ id: "q_new", sourceKey: NEW_KEY })];
    const plan = targets.planStaleOutputRelease({ target, media: { src: NEW_SRC, hlsUrl: HLS, storageKey: KEY, transcode: ready, posterUrl: POSTER }, jobs });
    assert.deepEqual(plan.patch, { hlsUrl: undefined, storageKey: undefined, transcode: undefined, posterUrl: undefined });
    assert.equal(plan.releasedVersion, "videos/course/crs_cp/preview/hls/v1/");
    assert.equal(plan.releasedPoster, POSTER);
    assert.deepEqual(plan.obsoleteJobIds, ["q_old"]);
    assert.equal(plan.abortJobId, "r_old");
  });

  it("releases everything when the preview becomes a link or is removed", () => {
    for (const src of ["https://cdn.example.com/a.mp4", undefined]) {
      const plan = targets.planStaleOutputRelease({ target, media: { src, hlsUrl: HLS, storageKey: KEY, transcode: ready }, jobs: [job({ id: "q" })] });
      assert.ok(plan.patch && "hlsUrl" in plan.patch && "transcode" in plan.patch);
      assert.deepEqual(plan.obsoleteJobIds, ["q"]);
    }
  });

  it("keeps a lesson block's poster (the editor may have chosen it)", () => {
    const block = targets.lessonBlockTarget("les_1", "blk_1");
    const plan = targets.planStaleOutputRelease({ target: block, media: { src: NEW_SRC, hlsUrl: HLS, storageKey: KEY, posterUrl: POSTER }, jobs: [] });
    assert.ok(plan.patch && !("posterUrl" in plan.patch));
    assert.equal(plan.releasedPoster, null);
  });

  it("clears a conversion state left by a job for an older file", () => {
    const pending = { status: "pending" as const, progress: 0, updatedAt: "t" };
    const leftover = targets.planStaleOutputRelease({ target, media: { src: NEW_SRC, transcode: pending }, jobs: [job({ id: "old", status: "failed", sourceKey: KEY })] });
    assert.deepEqual(leftover.patch, { transcode: undefined });
    const current = targets.planStaleOutputRelease({ target, media: { src: SRC, transcode: pending }, jobs: [job({ id: "cur", sourceKey: KEY })] });
    assert.equal(current.patch, null);
    const unavailable = { status: "unavailable" as const, updatedAt: "t" };
    assert.equal(targets.planStaleOutputRelease({ target, media: { src: NEW_SRC, transcode: unavailable }, jobs: [job({ id: "o", sourceKey: KEY })] }).patch, null);
    assert.deepEqual(targets.planStaleOutputRelease({ target, media: { src: undefined, transcode: unavailable }, jobs: [] }).patch, { transcode: undefined });
  });
});

/* ------------------------------------------------------------------ */
/* View model and queue table                                           */
/* ------------------------------------------------------------------ */

function previewStatus(overrides: Partial<CoursePreviewMediaStatus> = {}): CoursePreviewMediaStatus {
  return {
    courseId: "crs_cp",
    enabled: true,
    ffmpeg: { available: true, error: null, hint: null },
    convertible: true,
    saved: true,
    savedSrc: SRC,
    transcode: null,
    hlsReady: false,
    job: null,
    configuredRenditions: [1080, 720, 480],
    posterUrl: null,
    editHref: "/admin/courses/crs_cp",
    ...overrides,
  };
}

describe("course preview conversion panel", () => {
  it("talks about the course and its visitors", () => {
    assert.match(describeMediaStatus(previewStatus(), NEW_SRC, "course").detail ?? "", /Save the course to convert the new video\. Visitors see the saved one/);
    const running = describeMediaStatus(
      previewStatus({ job: { id: "j", status: "running", progress: 42, attempts: 1, error: null, createdAt: "t", startedAt: "t", finishedAt: null, queuePosition: null, heights: [1080, 720, 480], speed: 2 } }),
      SRC,
      "course",
    );
    assert.equal(running.title, "Processing 42% (1080p/720p/480p)");
    assert.match(running.detail ?? "", /^Visitors get the original file/);
    const failed = describeMediaStatus(previewStatus({ transcode: { status: "failed", error: "Bad file", updatedAt: "t" } }), SRC, "course");
    assert.equal(failed.title, "Failed");
    assert.equal(failed.convert, "retry");
    assert.match(failed.detail ?? "", /Visitors get the original file\./);
  });

  it("keeps the lesson wording by default", () => {
    assert.match(describeMediaStatus(previewStatus(), NEW_SRC).detail ?? "", /Save the lesson .* Learners see/);
  });

  it("says the converter is missing (the MP4 plays) and stops polling", () => {
    const view = describeMediaStatus(previewStatus({ ffmpeg: { available: false, error: "missing", hint: "Install ffmpeg." }, transcode: { status: "unavailable", updatedAt: "t" } }), SRC, "course");
    assert.equal(view.title, "Converter not installed");
    assert.equal(view.pollMs, null);
  });

  it("lists course preview jobs in the queue table", () => {
    const db = {
      lessons: [makeLesson({ id: "les_q", courseId: "crs_cp", chapterId: "chp_q", title: "Welcome" })],
      courses: [makeCourse({ id: "crs_cp", title: "Photography" })],
      transcodeJobs: [job({ id: "p" }), job({ id: "l", target: undefined, lessonId: "les_q", blockId: "blk_q" }), job({ id: "gone", target: { kind: "course-preview", courseId: "crs_gone" } })],
    };
    const page = queuePage(db, { filter: "all" });
    const byId = new Map(page.rows.map((r) => [r.job.id, r]));
    assert.deepEqual(
      { kind: byId.get("p")!.kind, lessonTitle: byId.get("p")!.lessonTitle, courseTitle: byId.get("p")!.courseTitle, editHref: byId.get("p")!.editHref },
      { kind: "course-preview", lessonTitle: COURSE_PREVIEW_ROW_TITLE, courseTitle: "Photography", editHref: "/admin/courses/crs_cp" },
    );
    assert.equal(byId.get("l")!.kind, "lesson-block");
    assert.equal(byId.get("l")!.editHref, "/admin/courses/crs_cp/lessons/les_q");
    assert.equal(byId.get("gone")!.editHref, null);
    assert.deepEqual(
      queuePage(db, { filter: "all", query: "preview video" }).rows.map((r) => r.job.id),
      ["p"],
    );
  });
});

/* ------------------------------------------------------------------ */
/* Playback                                                             */
/* ------------------------------------------------------------------ */

describe("course preview playback", () => {
  it("authorizes the stream's playlists and segments for the course", () => {
    const course = { videoUrl: SRC, previewHlsUrl: HLS };
    assert.ok(courseReferencesPath(course, SRC));
    assert.ok(courseReferencesPath(course, HLS));
    assert.ok(courseReferencesPath(course, "/uploads/videos/course/crs_cp/preview/hls/v1/720p/seg_00003.m4s"));
    assert.ok(courseReferencesPath(course, "/uploads/VIDEOS/course/crs_cp/preview/hls/v1/720p/index.m3u8"), "paths compare case-insensitively");
    assert.ok(!courseReferencesPath(course, "/uploads/videos/course/crs_cp/preview/hls/v2/master.m3u8"));
    assert.ok(!courseReferencesPath(course, "/uploads/videos/course/crs_cp/preview/secret.mp4"));
    assert.ok(!courseReferencesPath({ videoUrl: SRC }, "/uploads/videos/course/crs_cp/preview/hls/v1/master.m3u8"));
  });

  it("lets anyone who can see a published course play its preview stream", async () => {
    const published = makeCourse({ id: "crs_cp", published: true, videoUrl: SRC, previewHlsUrl: HLS, previewStorageKey: KEY });
    await resetDb({ courses: [published] });
    const decision = await authorizeMediaAccess(null, "/uploads/videos/course/crs_cp/preview/hls/v1/480p/seg_00001.m4s");
    assert.deepEqual(decision, { ok: true, via: "course" });
    const unknown = await authorizeMediaAccess(null, "/uploads/videos/course/crs_cp/preview/hls/zz/master.m3u8");
    assert.equal(unknown.ok, false);
  });

  it("gives the player the stream only for the current upload, with the MP4 as fallback", () => {
    const base = { videoUrl: SRC, previewHlsUrl: HLS, previewStorageKey: KEY, previewPosterUrl: POSTER, imageUrl: undefined };
    assert.deepEqual(coursePreviewPlayback(base), { src: SRC, hlsUrl: HLS, poster: POSTER });
    assert.deepEqual(coursePreviewPlayback({ ...base, imageUrl: "/uploads/images/cover.jpg" }), { src: SRC, hlsUrl: HLS, poster: "/uploads/images/cover.jpg" });
    assert.equal(coursePreviewPlayback({ ...base, videoUrl: NEW_SRC })?.hlsUrl, undefined);
    assert.equal(coursePreviewPlayback({ ...base, previewHlsUrl: undefined })?.hlsUrl, undefined);
    assert.equal(coursePreviewPlayback({ ...base, videoUrl: undefined }), null);
  });
});

/* ------------------------------------------------------------------ */
/* Queue, worker, status route and actions                              */
/* ------------------------------------------------------------------ */

describe("course preview conversions", () => {
  const instructor = makeUser({ id: "usr_cp_instr", roles: ["course_creator"] });
  const outsider = makeUser({ id: "usr_cp_out", roles: ["course_creator"] });
  const baseCourse = makeCourse({ id: "crs_cp", title: "Photography", instructorIds: [instructor.id], createdById: instructor.id, videoUrl: SRC });

  async function seed(course: Partial<Course> = {}, jobs: TranscodeJob[] = [], settings: SettingsPatch = {}): Promise<void> {
    await resetDb({ users: [instructor, outsider], courses: [{ ...baseCourse, ...course }], transcodeJobs: jobs, settings });
  }

  async function course(): Promise<Course> {
    const c = (await getDb()).courses.find((x) => x.id === "crs_cp");
    assert.ok(c);
    return c;
  }

  async function as(user: User | null) {
    resetRequest();
    if (user) await createSession(user.id);
  }

  async function get(query: string) {
    const url = new URL(`/api/media/status?${query}`, "https://lms.test");
    const res = await statusGET(Object.assign(new Request(url), { nextUrl: url }) as unknown as NextRequest);
    return { res, body: (await res.json()) as { ok: boolean; status?: CoursePreviewMediaStatus; error?: string } };
  }

  beforeEach(() => {
    holdWorker();
    setFfmpeg(true);
    mock.method(console, "error", () => undefined);
  });
  afterEach(() => mock.restoreAll());

  it("queues an uploaded preview once and marks it pending", async () => {
    await seed();
    const res = await queue.enqueueCoursePreviewTranscode("crs_cp");
    assert.ok(res.ok && res.created);
    assert.deepEqual(res.job.target, { kind: "course-preview", courseId: "crs_cp" });
    assert.equal(res.job.sourceKey, KEY);
    assert.equal((await course()).previewTranscode?.status, "pending");
    const again = await queue.enqueueCoursePreviewTranscode("crs_cp");
    assert.ok(again.ok && !again.created);
    assert.equal((await getDb()).transcodeJobs.length, 1);
  });

  it("marks the preview unavailable without ffmpeg, so the MP4 keeps playing", async () => {
    setFfmpeg(false);
    await seed();
    const res = await queue.enqueueCoursePreviewTranscode("crs_cp");
    assert.ok(!res.ok && res.reason === "unavailable");
    const c = await course();
    assert.equal(c.previewTranscode?.status, "unavailable");
    assert.equal(c.previewHlsUrl, undefined);
    assert.equal((await getDb()).transcodeJobs.length, 0);
    assert.deepEqual(coursePreviewPlayback(c), { src: SRC, hlsUrl: undefined, poster: undefined });
  });

  it("does nothing while adaptive streaming is off", async () => {
    await seed({}, [], { storage: { transcodeToHls: false, renditions: [720], autoTranscribe: false } });
    assert.equal(await queue.syncCoursePreviewTranscode("crs_cp"), 0);
    assert.equal((await getDb()).transcodeJobs.length, 0);
  });

  it("queues the preview after a save and when its upload completes", async () => {
    await seed();
    assert.equal(await queue.syncCoursePreviewTranscode("crs_cp"), 1);
    assert.equal(await queue.syncCoursePreviewTranscode("crs_cp"), 0);

    await seed({ videoUrl: NEW_SRC });
    assert.equal(await queue.onSourceUploaded(NEW_KEY), 1);
    assert.equal((await getDb()).transcodeJobs[0]!.sourceKey, NEW_KEY);
  });

  it("releases the stream of a preview that was replaced by a link", async () => {
    await seed(
      { videoUrl: "https://cdn.example.com/intro.mp4", previewHlsUrl: HLS, previewStorageKey: KEY, previewPosterUrl: POSTER, previewTranscode: { status: "ready", progress: 100, updatedAt: "t" } },
      [job({ id: "tcj_waiting", sourceKey: KEY })],
    );
    const versionDir = path.join(uploadRoot(), "videos", "course", "crs_cp", "preview", "hls", "v1");
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(path.join(versionDir, "master.m3u8"), "#EXTM3U\n");
    const posterDir = path.join(uploadRoot(), "posters", "course", "crs_cp");
    mkdirSync(posterDir, { recursive: true });
    writeFileSync(path.join(posterDir, "preview-v1.jpg"), "jpg");

    assert.equal(await queue.syncCoursePreviewTranscode("crs_cp"), 0);
    const c = await course();
    assert.equal(c.previewHlsUrl, undefined);
    assert.equal(c.previewStorageKey, undefined);
    assert.equal(c.previewTranscode, undefined);
    assert.equal(c.previewPosterUrl, undefined);
    const row = (await getDb()).transcodeJobs[0]!;
    assert.equal(row.status, "failed");
    assert.equal(row.error, "Replaced by a newer video.");
    assert.ok(!existsSync(path.join(versionDir, "master.m3u8")), "the released version is deleted");
    assert.ok(!existsSync(path.join(posterDir, "preview-v1.jpg")), "the generated poster is deleted");
    assert.equal(await queue.releaseStaleTargetOutput(target), false, "a second run has nothing to do");
  });

  it("replaces the stream of an old upload with a new conversion", async () => {
    await seed({ videoUrl: NEW_SRC, previewHlsUrl: HLS, previewStorageKey: KEY, previewTranscode: { status: "ready", progress: 100, updatedAt: "t" } });
    assert.equal(await queue.syncCoursePreviewTranscode("crs_cp"), 1);
    const c = await course();
    assert.equal(c.previewHlsUrl, undefined);
    assert.equal(c.previewTranscode?.status, "pending");
    assert.equal((await getDb()).transcodeJobs[0]!.sourceKey, NEW_KEY);
  });

  it("records a failed conversion with Retry and tells the instructors", async () => {
    await seed({}, [job({ id: "tcj_cp_run" })]);
    mkdirSync(path.join(uploadRoot(), "videos"), { recursive: true });
    writeFileSync(path.join(uploadRoot(), KEY), "not really a video");
    await runWorker();
    const db = await getDb();
    assert.equal(db.transcodeJobs[0]!.status, "failed");
    const c = await course();
    assert.equal(c.previewTranscode?.status, "failed");
    assert.equal(c.previewHlsUrl, undefined);
    const note = db.notifications.find((n) => n.userId === instructor.id);
    assert.ok(note);
    assert.match(note.subject ?? "", /Video conversion failed: Photography \(preview video\)/);
    assert.equal(note.link, "/admin/courses/crs_cp");
    assert.match(note.message ?? "", /Visitors still get the original file/);

    holdWorker();
    const retried = await queue.retryTranscodeJob("tcj_cp_run");
    assert.ok(retried.ok && retried.created);
    assert.deepEqual(retried.job.target, { kind: "course-preview", courseId: "crs_cp" });
  });

  it("serves the status to course managers and queues on the first poll", async () => {
    await seed({}, [], { storage: { transcodeToHls: true, renditions: [720, 480], autoTranscribe: false } });
    await as(null);
    assert.equal((await get("courseId=crs_cp")).res.status, 401);
    await as(outsider);
    assert.equal((await get("courseId=crs_cp")).res.status, 403);
    await as(instructor);
    assert.equal((await get("courseId=..%2Fx")).res.status, 400);
    assert.equal((await get("courseId=crs_gone")).res.status, 404);

    const { res, body } = await get("courseId=crs_cp");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const s = body.status!;
    assert.equal(s.courseId, "crs_cp");
    assert.equal(s.savedSrc, SRC);
    assert.equal(s.convertible, true);
    assert.equal(s.job?.status, "queued");
    assert.deepEqual(s.configuredRenditions, [720, 480]);
    assert.equal(describeMediaStatus(s, SRC, "course").title, "Queued, starting soon");
    await get("courseId=crs_cp");
    assert.equal((await getDb()).transcodeJobs.length, 1, "polling again does not queue twice");
  });

  it("reports 'unavailable' without ffmpeg", async () => {
    setFfmpeg(false);
    await seed();
    await as(instructor);
    const s = (await get("courseId=crs_cp")).body.status!;
    assert.equal(s.ffmpeg.available, false);
    assert.ok(s.ffmpeg.hint);
    assert.equal(s.transcode?.status, "unavailable");
    assert.equal(describeMediaStatus(s, SRC, "course").title, "Converter not installed");
  });

  it("lets course managers convert again and cancel from the course settings", async () => {
    await seed({ previewHlsUrl: HLS, previewStorageKey: KEY, previewTranscode: { status: "ready", progress: 100, updatedAt: "t" } });
    await as(outsider);
    const denied = await actions.transcodeCoursePreviewAction("crs_cp");
    assert.ok(!denied.ok);
    await as(instructor);
    assert.ok(!(await actions.transcodeCoursePreviewAction("../crs")).ok);
    const started = await actions.transcodeCoursePreviewAction("crs_cp");
    assert.ok(started.ok, started.ok ? "" : started.error);
    assert.equal(started.data.job?.status, "queued");
    assert.equal(started.data.hlsReady, true, "the previous stream keeps playing meanwhile");

    const cancelled = await actions.cancelCoursePreviewTranscodeAction("crs_cp");
    assert.ok(cancelled.ok, cancelled.ok ? "" : cancelled.error);
    assert.equal(cancelled.data.transcode?.status, "ready");
    const nothing = await actions.cancelCoursePreviewTranscodeAction("crs_cp");
    assert.ok(!nothing.ok);
  });

  it("refuses to convert a course without a preview video", async () => {
    await seed({ videoUrl: undefined });
    await as(instructor);
    const res = await actions.transcodeCoursePreviewAction("crs_cp");
    assert.ok(!res.ok);
    assert.match(res.error, /preview video/);
  });
});

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Lesson, LessonBlock, TranscodeJob } from "@/lib/types";

/**
 * Review fixes in the transcoding pipeline:
 *  - replacing or removing a lesson video stops a conversion still running
 *    for the old file (it would otherwise hold up the one-at-a-time queue);
 *  - a generated poster never outlives the video it shows, and generated
 *    posters nothing shows any more are deleted;
 *  - ffmpeg/ffprobe only get uploads stored (and checked) as videos, with
 *    the input protocols and demuxers locked down.
 */

const missing = path.join(tmpdir(), "ll-no-ffmpeg-here");
process.env.FFMPEG_PATH = path.join(missing, "ffmpeg");
process.env.FFPROBE_PATH = path.join(missing, "ffprobe");

const { makeCourse, makeLesson, makeUser, resetDb } = await import("./helpers/db");
const { getDb } = await import("@/lib/db/store");
const { uploadRoot } = await import("@/lib/storage");
const queue = await import("@/lib/media/transcode/queue");
const targets = await import("@/lib/media/transcode/targets");
const { GENERATED_POSTER_KEY, generatedPosterKey, preserveManagedVideoFields, transcodeSourceKey } = await import("@/lib/media/transcode/lesson-fields");
const { SOURCE_FORMATS, buildHlsPlan, buildPosterArgs, inputSafetyArgs } = await import("@/lib/media/transcode/plan");

const g = globalThis as unknown as {
  __llFfmpeg: { status?: Record<string, unknown> };
  __llTranscodeWorker: { running: boolean; current: { jobId: string; abort: AbortController; heights: number[]; speed: number | null } | null };
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

const instructor = makeUser({ id: "usr_tr_instr", roles: ["course_creator"] });
const course = makeCourse({ id: "crs_tr", instructorIds: [instructor.id], createdById: instructor.id });
const OLD_SRC = "/uploads/videos/old-lecture.mp4";
const OLD_KEY = "videos/old-lecture.mp4";
const NEW_SRC = "/uploads/videos/new-lecture.mp4";
const NEW_KEY = "videos/new-lecture.mp4";
const OLD_HLS = "/uploads/videos/les_tr/blk_tr/hls/v1/master.m3u8";
const OLD_POSTER = "/uploads/posters/les_tr/blk_tr-v1.jpg";

type VideoBlock = Extract<LessonBlock, { type: "video" }>;

function videoLesson(blocks: LessonBlock[]): Lesson {
  return makeLesson({ id: "les_tr", courseId: course.id, chapterId: "chp_tr", blocks });
}

function job(overrides: Partial<TranscodeJob> & Pick<TranscodeJob, "id">): TranscodeJob {
  return { lessonId: "les_tr", blockId: "blk_tr", sourceKey: OLD_KEY, status: "queued", progress: 0, attempts: 0, createdAt: "2026-09-01T10:00:00.000Z", ...overrides };
}

async function seed(blocks: LessonBlock[], jobs: TranscodeJob[] = []): Promise<void> {
  await resetDb({ users: [instructor], courses: [course], lessons: [videoLesson(blocks)], transcodeJobs: jobs });
}

async function videoBlock(id = "blk_tr"): Promise<VideoBlock> {
  const b = (await getDb()).lessons[0]!.blocks.find((x) => x.id === id);
  assert.ok(b && b.type === "video");
  return b as VideoBlock;
}

/** Pretend the worker is converting `jobId` right now. */
function running(jobId: string): AbortController {
  const abort = new AbortController();
  g.__llTranscodeWorker.current = { jobId, abort, heights: [1080, 720], speed: 1 };
  return abort;
}

function writeOld(file: string, contents = "x"): string {
  const full = path.join(uploadRoot(), ...file.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
  const old = new Date(Date.now() - 3 * 86_400_000);
  utimesSync(full, old, old);
  return full;
}

beforeEach(() => {
  // Keep the real worker idle: kickTranscodeWorker is a no-op while "running".
  g.__llTranscodeWorker.running = true;
  g.__llTranscodeWorker.current = null;
  setFfmpeg(true);
  mock.method(console, "error", () => undefined);
});
afterEach(() => {
  g.__llTranscodeWorker.current = null;
  mock.restoreAll();
});

describe("replacing a lesson video stops the old conversion", () => {
  it("plans to abort a running job for an older file", () => {
    const target = targets.lessonBlockTarget("les_tr", "blk_tr");
    const plan = targets.planEnqueue({
      target,
      media: { src: NEW_SRC },
      jobs: [job({ id: "tcj_run", status: "running" }), job({ id: "tcj_q", status: "queued" })],
      ffmpegAvailable: true,
    });
    assert.equal(plan.action, "create");
    assert.ok(plan.action === "create");
    assert.equal(plan.abortJobId, "tcj_run");
    assert.deepEqual(plan.obsoleteJobIds, ["tcj_q"]);
  });

  it("aborts the running conversion when the lesson is saved with a new video, and queues the new one", async () => {
    await seed([{ id: "blk_tr", type: "video", src: NEW_SRC }], [job({ id: "tcj_old", status: "running", attempts: 1 })]);
    const abort = running("tcj_old");
    const created = await queue.syncLessonTranscodes("les_tr");
    assert.equal(abort.signal.aborted, true, "the old conversion is stopped");
    assert.equal(created, 1);
    const jobs = (await getDb()).transcodeJobs;
    assert.ok(jobs.some((j) => j.sourceKey === NEW_KEY && j.status === "queued"));
  });

  it("leaves a running conversion of the current file alone", async () => {
    await seed([{ id: "blk_tr", type: "video", src: OLD_SRC }], [job({ id: "tcj_cur", status: "running", attempts: 1 })]);
    const abort = running("tcj_cur");
    await queue.syncLessonTranscodes("les_tr");
    assert.equal(abort.signal.aborted, false);
  });

  it("stops conversions of video blocks that were removed from the lesson", async () => {
    await seed([{ id: "blk_md", type: "markdown", content: "No video any more" } as LessonBlock], [job({ id: "tcj_run", status: "running", attempts: 1 }), job({ id: "tcj_wait", blockId: "blk_gone", createdAt: "2026-09-02T10:00:00.000Z" })]);
    const abort = running("tcj_run");
    await queue.syncLessonTranscodes("les_tr");
    assert.equal(abort.signal.aborted, true);
    const waiting = (await getDb()).transcodeJobs.find((j) => j.id === "tcj_wait")!;
    assert.equal(waiting.status, "failed");
    assert.match(waiting.error ?? "", /removed/);
  });
});

describe("generated posters", () => {
  it("recognises posters the pipeline made, and whose they are", () => {
    assert.ok(GENERATED_POSTER_KEY.test("posters/les_tr/blk_tr-v1.jpg"));
    assert.ok(GENERATED_POSTER_KEY.test("posters/course/crs_1/preview-v1.jpg"));
    assert.ok(!GENERATED_POSTER_KEY.test("posters/../etc-v1.jpg"));
    assert.ok(!GENERATED_POSTER_KEY.test("my-poster-abc.jpg"));
    assert.equal(generatedPosterKey("/uploads/my-poster-abc.jpg"), null);
    const target = targets.lessonBlockTarget("les_tr", "blk_tr");
    assert.equal(targets.ownGeneratedPosterKey(target, OLD_POSTER), "posters/les_tr/blk_tr-v1.jpg");
    assert.equal(targets.ownGeneratedPosterKey(target, "/uploads/posters/les_tr/blk_other-v1.jpg"), null);
    assert.equal(targets.ownGeneratedPosterKey(target, "/uploads/posters/course/crs_1/preview-v1.jpg"), null);
  });

  it("drops the old video's generated poster when an editor saves a new video", () => {
    const stored: LessonBlock[] = [{ id: "blk_tr", type: "video", src: OLD_SRC, hlsUrl: OLD_HLS, storageKey: OLD_KEY, posterUrl: OLD_POSTER }];
    // The editor still holds the generated poster of the old file.
    const [replaced] = preserveManagedVideoFields(stored, [{ id: "blk_tr", type: "video", src: NEW_SRC, posterUrl: OLD_POSTER }]);
    assert.ok(replaced!.type === "video");
    assert.equal((replaced as VideoBlock).posterUrl, undefined);
    // A poster the editor chose stays with the new video.
    const [own] = preserveManagedVideoFields(stored, [{ id: "blk_tr", type: "video", src: NEW_SRC, posterUrl: "/uploads/cover-abc.jpg" }]);
    assert.equal((own as VideoBlock).posterUrl, "/uploads/cover-abc.jpg");
    // The same file keeps its generated poster; a forged one is replaced by the stored poster.
    const [same] = preserveManagedVideoFields(stored, [{ id: "blk_tr", type: "video", src: OLD_SRC, posterUrl: "/uploads/posters/les_x/blk_x-v9.jpg" }]);
    assert.equal((same as VideoBlock).posterUrl, OLD_POSTER);
  });

  it("releases a lesson block's own generated poster with output of a replaced file", () => {
    const target = targets.lessonBlockTarget("les_tr", "blk_tr");
    const plan = targets.planStaleOutputRelease({ target, media: { src: NEW_SRC, hlsUrl: OLD_HLS, storageKey: OLD_KEY, posterUrl: OLD_POSTER }, jobs: [] });
    assert.ok(plan.patch && "posterUrl" in plan.patch);
    assert.equal(plan.releasedPoster, OLD_POSTER);
    const editorPoster = targets.planStaleOutputRelease({ target, media: { src: NEW_SRC, hlsUrl: OLD_HLS, storageKey: OLD_KEY, posterUrl: "/uploads/cover-abc.jpg" }, jobs: [] });
    assert.equal(editorPoster.releasedPoster, null);
  });

  it("deletes the released poster file unless another block still shows it", async () => {
    const file = writeOld("posters/les_tr/blk_tr-v1.jpg");
    await seed([{ id: "blk_tr", type: "video", src: NEW_SRC, hlsUrl: OLD_HLS, storageKey: OLD_KEY, posterUrl: OLD_POSTER }]);
    await queue.releaseStaleTargetOutput(targets.lessonBlockTarget("les_tr", "blk_tr"));
    assert.equal((await videoBlock()).posterUrl, undefined);
    assert.equal(existsSync(file), false);

    const shared = writeOld("posters/les_tr/blk_tr-v1.jpg");
    await seed([
      { id: "blk_tr", type: "video", src: NEW_SRC, hlsUrl: OLD_HLS, storageKey: OLD_KEY, posterUrl: OLD_POSTER },
      // e.g. a duplicated block that still shows the poster
      { id: "blk_copy", type: "video", src: OLD_SRC, posterUrl: OLD_POSTER },
    ]);
    await queue.releaseStaleTargetOutput(targets.lessonBlockTarget("les_tr", "blk_tr"));
    assert.equal(existsSync(shared), true);
  });

  it("sweeps generated posters nothing shows any more", async () => {
    const orphan = writeOld("posters/les_tr/blk_tr-v0.jpg");
    const current = writeOld("posters/les_tr/blk_tr-v1.jpg");
    const other = writeOld("posters/notes.txt");
    const fresh = path.join(uploadRoot(), "posters", "les_tr", "blk_tr-v2.jpg");
    writeFileSync(fresh, "x");
    await seed([{ id: "blk_tr", type: "video", src: OLD_SRC, posterUrl: OLD_POSTER }]);
    const removed = await queue.cleanupOrphanedPosters();
    assert.equal(removed, 1);
    assert.equal(existsSync(orphan), false);
    assert.equal(existsSync(current), true);
    assert.equal(existsSync(other), true, "files the pipeline did not make are never touched");
    assert.equal(existsSync(fresh), true, "a poster being published is never touched");
  });
});

describe("ffmpeg inputs", () => {
  it("converts only uploads stored as videos", () => {
    assert.equal(transcodeSourceKey("/uploads/videos/lecture.mp4"), "videos/lecture.mp4");
    assert.equal(transcodeSourceKey("/uploads/VIDEOS/lecture.mp4"), "VIDEOS/lecture.mp4");
    // A "document" (audio/mp4) stored at the upload root is never handed to ffmpeg.
    assert.equal(transcodeSourceKey("/uploads/notes-abc.mp4"), null);
    assert.equal(transcodeSourceKey("/uploads/posters/x.mp4"), null);
  });

  it("locks down the input protocols and demuxers of every ffmpeg and ffprobe run", () => {
    assert.deepEqual(inputSafetyArgs("C:\\uploads\\videos\\a.mp4"), ["-protocol_whitelist", "file", "-format_whitelist", SOURCE_FORMATS]);
    assert.deepEqual(inputSafetyArgs("https://bucket.s3.amazonaws.com/videos/a.mp4?X-Amz-Signature=x"), ["-protocol_whitelist", "https,tls,tcp", "-format_whitelist", SOURCE_FORMATS]);
    assert.deepEqual(inputSafetyArgs("http://localhost:9000/b/videos/a.mp4"), ["-protocol_whitelist", "http,tcp", "-format_whitelist", SOURCE_FORMATS]);
    assert.ok(!SOURCE_FORMATS.split(",").includes("hls"));

    const probe = { duration: 60, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, videoCodec: "h264", sizeBytes: null };
    for (const args of [buildHlsPlan("/data/in.mp4", probe, [720]).args, buildPosterArgs("/data/in.mp4", probe)]) {
      const input = args.indexOf("-i");
      const whitelist = args.indexOf("-protocol_whitelist");
      assert.ok(whitelist >= 0 && whitelist < input, "the whitelist applies to the input");
      assert.equal(args[whitelist + 1], "file");
      assert.ok(args.indexOf("-format_whitelist") < input);
    }
  });

  it("refuses to convert a stored source that is not a video container", async () => {
    writeOld(OLD_KEY, "#EXTM3U\n#EXTINF:1,\nhttp://169.254.169.254/latest/meta-data/\n");
    await seed([{ id: "blk_tr", type: "video", src: OLD_SRC }], [job({ id: "tcj_bad" })]);
    g.__llTranscodeWorker.running = false;
    queue.kickTranscodeWorker();
    const until = Date.now() + 15_000;
    while (queue.isWorkerRunning()) {
      if (Date.now() > until) throw new Error("The transcode worker did not finish.");
      await new Promise((r) => setTimeout(r, 20));
    }
    const row = (await getDb()).transcodeJobs[0]!;
    assert.equal(row.status, "failed");
    assert.match(row.error ?? "", /not a video/);
  });
});

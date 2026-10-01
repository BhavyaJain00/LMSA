import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { Database, Lesson, LessonBlock, TranscodeJob } from "@/lib/types";
import type { SettingsPatch } from "./helpers/db";

/**
 * The durable transcoding queue: queueing rules, retries and cancels,
 * restart recovery (capped), the worker's failure path, housekeeping, the
 * upload-completion and onVideoReady hooks and `/api/cron/media`.
 *
 * ffmpeg is not needed: the binaries point at a missing path (set before the
 * modules load), and the detection cache is primed to say "available" or
 * "missing" per test. The worker is held idle unless a test releases it.
 */

const missing = path.join(tmpdir(), "ll-no-ffmpeg-here");
process.env.FFMPEG_PATH = path.join(missing, "ffmpeg");
process.env.FFPROBE_PATH = path.join(missing, "ffprobe");

const { makeCourse, makeLesson, makeUser, resetDb } = await import("./helpers/db");
const { getDb } = await import("@/lib/db/store");
const { uploadRoot } = await import("@/lib/storage");
const { buildMasterPlaylist } = await import("@/lib/media/hls");
const { cronKey } = await import("@/lib/email");
const queue = await import("@/lib/media/transcode/queue");
const { GET: cronGET, POST: cronPOST } = await import("@/app/api/cron/media/route");

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

/** Keep the worker from starting (kickTranscodeWorker is a no-op while "running"). */
function holdWorker(): void {
  g.__llTranscodeWorker.running = true;
}

/** Let the real worker run and wait until it has drained the queue. */
async function runWorker(): Promise<void> {
  g.__llTranscodeWorker.running = false;
  queue.kickTranscodeWorker();
  const until = Date.now() + 15_000;
  while (queue.isWorkerRunning()) {
    if (Date.now() > until) throw new Error("The transcode worker did not finish.");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const instructor = makeUser({ id: "usr_tq_instr", roles: ["course_creator"] });
const course = makeCourse({ id: "crs_tq", instructorIds: [instructor.id], createdById: instructor.id });
const SRC = "/uploads/videos/lecture.mp4";
const KEY = "videos/lecture.mp4";

function videoLesson(id: string, blocks: LessonBlock[]): Lesson {
  return makeLesson({ id, courseId: course.id, chapterId: "chp_tq", blocks });
}

function video(id: string, extra: Partial<Extract<LessonBlock, { type: "video" }>> = {}): LessonBlock {
  return { id, type: "video", src: SRC, ...extra };
}

function job(overrides: Partial<TranscodeJob> & Pick<TranscodeJob, "id">): TranscodeJob {
  return { lessonId: "les_tq", blockId: "blk_tq", sourceKey: KEY, status: "queued", progress: 0, attempts: 0, createdAt: "2026-09-01T10:00:00.000Z", ...overrides };
}

async function seed(blocks: LessonBlock[] = [video("blk_tq")], jobs: TranscodeJob[] = [], settings: SettingsPatch = {}): Promise<void> {
  await resetDb({ users: [instructor], courses: [course], lessons: [videoLesson("les_tq", blocks)], transcodeJobs: jobs, settings });
}

async function block(lessonId = "les_tq", blockId = "blk_tq") {
  const db = await getDb();
  const b = db.lessons.find((l) => l.id === lessonId)?.blocks.find((x) => x.id === blockId);
  assert.ok(b && b.type === "video");
  return b as Extract<LessonBlock, { type: "video" }>;
}

beforeEach(() => {
  holdWorker();
  setFfmpeg(true);
  mock.method(console, "error", () => undefined);
});
afterEach(() => mock.restoreAll());

describe("enqueueTranscode", () => {
  it("does nothing while adaptive streaming is off", async () => {
    await seed(undefined, [], { storage: { transcodeToHls: false, renditions: [1080, 720, 480], autoTranscribe: false } });
    const res = await queue.enqueueTranscode("les_tq", "blk_tq");
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.reason, "disabled");
    assert.equal((await getDb()).transcodeJobs.length, 0);
  });

  it("marks the block unavailable when ffmpeg is missing, so the MP4 keeps playing", async () => {
    setFfmpeg(false);
    await seed();
    const res = await queue.enqueueTranscode("les_tq", "blk_tq");
    assert.equal(!res.ok && res.reason, "unavailable");
    const b = await block();
    assert.equal(b.transcode?.status, "unavailable");
    assert.match(b.transcode?.error ?? "", /not found/);
    assert.equal(b.src, SRC);
    assert.equal((await getDb()).transcodeJobs.length, 0);
  });

  it("queues a job once and marks the block pending", async () => {
    await seed();
    const first = await queue.enqueueTranscode("les_tq", "blk_tq");
    assert.ok(first.ok && first.created);
    assert.equal(first.job.sourceKey, KEY);
    assert.equal(first.job.status, "queued");
    assert.equal((await block()).transcode?.status, "pending");
    const again = await queue.enqueueTranscode("les_tq", "blk_tq");
    assert.ok(again.ok && !again.created && again.job.id === first.job.id);
    assert.equal((await getDb()).transcodeJobs.length, 1);
  });

  it("refuses missing blocks and files that are not uploads", async () => {
    await seed([video("blk_tq"), video("blk_ext", { src: "https://cdn.example.com/talk.mp4" })]);
    const gone = await queue.enqueueTranscode("les_tq", "blk_nope");
    assert.equal(!gone.ok && gone.reason, "not-found");
    const external = await queue.enqueueTranscode("les_tq", "blk_ext");
    assert.equal(!external.ok && external.reason, "not-upload");
  });

  it("leaves a converted file alone unless forced", async () => {
    await seed([video("blk_tq", { hlsUrl: "/uploads/videos/les_tq/blk_tq/hls/v1/master.m3u8", storageKey: KEY, transcode: { status: "ready", progress: 100, updatedAt: "t" } })]);
    const res = await queue.enqueueTranscode("les_tq", "blk_tq");
    assert.equal(!res.ok && res.reason, "ready");
    const forced = await queue.enqueueTranscode("les_tq", "blk_tq", { force: true });
    assert.ok(forced.ok && forced.created);
    // A forced re-conversion keeps playing the current version meanwhile.
    const b = await block();
    assert.equal(b.hlsUrl, "/uploads/videos/les_tq/blk_tq/hls/v1/master.m3u8");
    assert.equal(b.transcode?.status, "pending");
  });

  it("does not retry a failed file by itself, only when asked", async () => {
    await seed(undefined, [job({ id: "tcj_failed", status: "failed", error: "ffmpeg exited with code 1.\nmoov atom not found", attempts: 1 })]);
    const res = await queue.enqueueTranscode("les_tq", "blk_tq");
    assert.equal(!res.ok && res.reason, "failed");
    assert.equal(!res.ok && res.message, "ffmpeg exited with code 1.");
    const retry = await queue.retryTranscodeJob("tcj_failed");
    assert.ok(retry.ok && retry.created);
    assert.equal(retry.job.attempts, 0);
    assert.equal((await queue.retryTranscodeJob("tcj_unknown")).ok, false);
  });

  it("drops the old stream and stale jobs when the block plays a new file", async () => {
    await seed(
      [video("blk_tq", { src: "/uploads/videos/new.mp4", hlsUrl: "/uploads/videos/les_tq/blk_tq/hls/v1/master.m3u8", storageKey: KEY, transcode: { status: "ready", progress: 100, updatedAt: "t" } })],
      [job({ id: "tcj_old", status: "queued" })],
    );
    const res = await queue.enqueueTranscode("les_tq", "blk_tq");
    assert.ok(res.ok && res.created && res.job.sourceKey === "videos/new.mp4");
    const b = await block();
    assert.equal(b.hlsUrl, undefined);
    assert.equal(b.storageKey, undefined);
    assert.equal(b.transcode?.status, "pending");
    const old = (await getDb()).transcodeJobs.find((j) => j.id === "tcj_old");
    assert.equal(old?.status, "failed");
    assert.equal(old?.error, "Replaced by a newer video.");
  });

  it("re-links finished output instead of converting again when an editor save dropped it", async () => {
    await seed([video("blk_tq")], [job({ id: "tcj_done", status: "done", progress: 100, attempts: 1 })]);
    const dir = path.join(uploadRoot(), "videos", "les_tq", "blk_tq", "hls", "v1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "master.m3u8"),
      buildMasterPlaylist([
        { uri: "720p/index.m3u8", width: 1280, height: 720, bandwidth: 2_400_000, codecs: "avc1.64001f,mp4a.40.2" },
        { uri: "480p/index.m3u8", width: 852, height: 480, bandwidth: 1_200_000, codecs: "avc1.64001f,mp4a.40.2" },
      ]),
    );
    const res = await queue.enqueueTranscode("les_tq", "blk_tq");
    assert.equal(!res.ok && res.reason, "ready");
    const b = await block();
    assert.equal(b.hlsUrl, "/uploads/videos/les_tq/blk_tq/hls/v1/master.m3u8");
    assert.equal(b.storageKey, KEY);
    assert.deepEqual(b.transcode?.renditions?.map((r) => r.height).sort(), [480, 720]);
    assert.equal((await getDb()).transcodeJobs.length, 1);
  });
});

describe("syncing lessons", () => {
  it("queues every uploaded video that still needs a conversion", async () => {
    await resetDb({
      users: [instructor],
      courses: [course],
      lessons: [
        videoLesson("les_a", [video("blk_a1"), video("blk_a2", { src: "/uploads/videos/other.webm" }), { id: "md", type: "markdown", content: "x" }]),
        videoLesson("les_b", [video("blk_b1", { hlsUrl: "/uploads/videos/les_b/blk_b1/hls/v/master.m3u8", storageKey: KEY, transcode: { status: "ready", updatedAt: "t" } })]),
        videoLesson("les_c", [video("blk_c1", { src: "https://example.com/x.mp4" })]),
      ],
    });
    assert.equal(await queue.syncAllTranscodes(), 2);
    assert.equal(await queue.syncAllTranscodes(), 0);
    assert.equal(await queue.syncLessonTranscodes("les_missing"), 0);
    const jobs = (await getDb()).transcodeJobs;
    assert.deepEqual(jobs.map((j) => j.blockId).sort(), ["blk_a1", "blk_a2"]);
  });

  it("queues blocks that already play a file when its upload completes", async () => {
    await resetDb({
      users: [instructor],
      courses: [course],
      lessons: [videoLesson("les_a", [video("blk_a1"), video("blk_a2", { src: "/uploads/videos/other.mp4" })]), videoLesson("les_b", [video("blk_b1")])],
    });
    assert.equal(await queue.onSourceUploaded(KEY), 2);
    assert.deepEqual((await getDb()).transcodeJobs.map((j) => j.blockId).sort(), ["blk_a1", "blk_b1"]);
    assert.equal(await queue.onSourceUploaded("videos/unused.mp4"), 0);
  });

  it("does nothing on upload completion while adaptive streaming is off", async () => {
    await seed(undefined, [], { storage: { transcodeToHls: false, renditions: [720], autoTranscribe: false } });
    assert.equal(await queue.onSourceUploaded(KEY), 0);
    assert.equal((await getDb()).transcodeJobs.length, 0);
  });

  it("retries the blocks whose latest job failed", async () => {
    await resetDb({
      users: [instructor],
      courses: [course],
      lessons: [videoLesson("les_tq", [video("blk_tq"), video("blk_ok")])],
      transcodeJobs: [
        job({ id: "j1", status: "failed", createdAt: "2026-09-01T10:00:00.000Z" }),
        job({ id: "j2", status: "failed", createdAt: "2026-09-02T10:00:00.000Z" }),
        job({ id: "j3", blockId: "blk_ok", status: "failed", createdAt: "2026-09-01T10:00:00.000Z" }),
        job({ id: "j4", blockId: "blk_ok", status: "done", createdAt: "2026-09-03T10:00:00.000Z" }),
      ],
    });
    assert.equal(await queue.retryFailedTranscodes(), 1);
    const queued = (await getDb()).transcodeJobs.filter((j) => j.status === "queued");
    assert.deepEqual(queued.map((j) => j.blockId), ["blk_tq"]);
  });
});

describe("cancelling and status", () => {
  it("cancels a queued job and settles the block", async () => {
    await seed([video("blk_tq", { transcode: { status: "pending", updatedAt: "t" } })], [job({ id: "tcj_q" })]);
    assert.equal(await queue.cancelTranscodeJob("tcj_q"), true);
    const db = await getDb();
    assert.equal(db.transcodeJobs[0]!.status, "failed");
    assert.equal(db.transcodeJobs[0]!.error, "Cancelled by an administrator.");
    assert.equal((await block()).transcode?.status, "failed");
    assert.equal(await queue.cancelTranscodeJob("tcj_q"), false);
  });

  it("keeps an earlier finished version playing after a cancel", async () => {
    await seed(
      [video("blk_tq", { hlsUrl: "/uploads/videos/les_tq/blk_tq/hls/v1/master.m3u8", storageKey: KEY, transcode: { status: "pending", renditions: [{ height: 720, bandwidth: 1 }], updatedAt: "t" } })],
      [job({ id: "tcj_q" })],
    );
    assert.equal(await queue.cancelTranscodeJob("tcj_q"), true);
    const b = await block();
    assert.equal(b.transcode?.status, "ready");
    assert.deepEqual(b.transcode?.renditions, [{ height: 720, bandwidth: 1 }]);
  });

  it("reports queue positions and counts", async () => {
    await seed(undefined, [
      job({ id: "a", createdAt: "2026-09-01T10:00:00.000Z" }),
      job({ id: "b", blockId: "x", createdAt: "2026-09-01T11:00:00.000Z" }),
      job({ id: "c", status: "done", createdAt: "2026-09-01T09:00:00.000Z" }),
      job({ id: "d", status: "failed", createdAt: "2026-09-01T08:00:00.000Z" }),
    ]);
    const db = await getDb();
    const views = db.transcodeJobs.map((j) => queue.jobView(j, db.transcodeJobs));
    assert.deepEqual(views.map((v) => v.queuePosition), [1, 2, null, null]);
    assert.equal(views[0]!.heights, null);
    assert.deepEqual(await queue.getQueueCounts(), { queued: 2, running: 0, done: 1, failed: 1 });
    assert.equal(queue.latestJobFor(db, "les_tq", "blk_tq")?.id, "a");
    assert.equal(queue.latestJobFor(db, "les_tq", "none"), null);
  });
});

describe("restart recovery", () => {
  function dbWith(jobs: TranscodeJob[], blocks: LessonBlock[] = [video("blk_tq", { transcode: { status: "processing", progress: 40, updatedAt: "t" } })]): Database {
    return { lessons: [videoLesson("les_tq", blocks)], transcodeJobs: jobs } as unknown as Database;
  }

  it("queues interrupted jobs again", () => {
    const db = dbWith([job({ id: "r1", status: "running", progress: 40, attempts: 1 })]);
    assert.deepEqual(queue.recoverOrphanedJobs(db, null, "now"), []);
    assert.equal(db.transcodeJobs[0]!.status, "queued");
    assert.equal(db.transcodeJobs[0]!.progress, 0);
  });

  it(`fails a job after ${queue.MAX_JOB_ATTEMPTS} interrupted attempts`, () => {
    const db = dbWith([job({ id: "r1", status: "running", attempts: queue.MAX_JOB_ATTEMPTS })]);
    const failed = queue.recoverOrphanedJobs(db, null, "now");
    assert.deepEqual(failed.map((j) => j.id), ["r1"]);
    assert.equal(db.transcodeJobs[0]!.status, "failed");
    assert.equal(db.transcodeJobs[0]!.finishedAt, "now");
    assert.match(db.transcodeJobs[0]!.error ?? "", /interrupted 3 times/);
    const b = db.lessons[0]!.blocks[0]!;
    assert.ok(b.type === "video" && b.transcode?.status === "failed");
  });

  it("leaves the job this worker runs and other states alone", () => {
    const db = dbWith([
      job({ id: "mine", status: "running", attempts: 5 }),
      job({ id: "q", status: "queued", attempts: 2 }),
      job({ id: "d", status: "done", attempts: 9 }),
    ]);
    assert.deepEqual(queue.recoverOrphanedJobs(db, "mine"), []);
    assert.deepEqual(db.transcodeJobs.map((j) => j.status), ["running", "queued", "done"]);
  });

  it("does not touch a block that already plays another file", () => {
    const db = dbWith([job({ id: "r1", status: "running", attempts: 3 })], [video("blk_tq", { src: "/uploads/videos/new.mp4", transcode: { status: "pending", updatedAt: "t" } })]);
    queue.recoverOrphanedJobs(db, null, "now");
    const b = db.lessons[0]!.blocks[0]!;
    assert.ok(b.type === "video" && b.transcode?.status === "pending");
  });
});

describe("worker", () => {
  it("records a failure with the error, settles the block and tells the instructors", async () => {
    await seed([video("blk_tq")], [job({ id: "tcj_run" })]);
    mkdirSync(path.join(uploadRoot(), "videos"), { recursive: true });
    writeFileSync(path.join(uploadRoot(), KEY), "not really a video");
    await runWorker();
    const db = await getDb();
    const row = db.transcodeJobs[0]!;
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 1);
    assert.ok(row.startedAt && row.finishedAt);
    assert.match(row.error ?? "", /ffprobe could not read the video/);
    const b = await block();
    assert.equal(b.transcode?.status, "failed");
    assert.equal(b.hlsUrl, undefined);
    const note = db.notifications.find((n) => n.userId === instructor.id);
    assert.ok(note);
    assert.match(note.subject ?? "", /Video conversion failed/);
    assert.equal(note.link, `/admin/courses/${course.id}/lessons/les_tq`);
    assert.ok(!existsSync(path.join(uploadRoot(), ".transcode", "tcj_run")), "the work folder is removed");
  });

  it("fails a job whose block is gone without converting", async () => {
    await seed([video("blk_other")], [job({ id: "tcj_gone" })]);
    await runWorker();
    const row = (await getDb()).transcodeJobs[0]!;
    assert.equal(row.status, "failed");
    assert.match(row.error ?? "", /removed or replaced/);
    // Cancellations of vanished blocks are not reported to instructors.
    assert.equal((await getDb()).notifications.length, 0);
  });

  it("stops retrying a job that keeps getting interrupted, and runs the rest of the queue", async () => {
    await seed(
      [video("blk_tq")],
      [job({ id: "tcj_crashy", status: "running", attempts: 3, createdAt: "2026-09-01T09:00:00.000Z" }), job({ id: "tcj_next", blockId: "blk_gone", createdAt: "2026-09-01T10:00:00.000Z" })],
    );
    await runWorker();
    const db = await getDb();
    const crashy = db.transcodeJobs.find((j) => j.id === "tcj_crashy")!;
    assert.equal(crashy.status, "failed");
    assert.equal(crashy.attempts, 3);
    assert.match(crashy.error ?? "", /interrupted 3 times/);
    assert.equal(db.transcodeJobs.find((j) => j.id === "tcj_next")!.status, "failed");
    assert.ok(db.notifications.some((n) => n.dedupeKey === "transcode:tcj_crashy:failed"));
  });

  it("starts an interrupted job again with one more attempt", async () => {
    await seed([video("blk_other")], [job({ id: "tcj_again", status: "running", attempts: 1 })]);
    await runWorker();
    const row = (await getDb()).transcodeJobs[0]!;
    assert.equal(row.attempts, 2);
    assert.equal(row.status, "failed");
  });
});

describe("housekeeping", () => {
  it("prunes old finished jobs but keeps each block's newest and active ones", async () => {
    const now = Date.parse("2026-10-01T00:00:00.000Z");
    await seed(undefined, [
      job({ id: "old_done", status: "done", createdAt: "2026-08-01T00:00:00.000Z" }),
      job({ id: "newest", status: "failed", createdAt: "2026-08-02T00:00:00.000Z" }),
      job({ id: "old_other_block", blockId: "solo", status: "done", createdAt: "2026-07-01T00:00:00.000Z" }),
      job({ id: "old_queued", blockId: "q", status: "queued", createdAt: "2026-07-01T00:00:00.000Z" }),
      job({ id: "old_q2", blockId: "q", status: "failed", createdAt: "2026-07-02T00:00:00.000Z" }),
      job({ id: "recent", blockId: "r", status: "done", createdAt: "2026-09-25T00:00:00.000Z" }),
    ]);
    assert.equal(await queue.pruneTranscodeJobs(now), 1);
    assert.deepEqual((await getDb()).transcodeJobs.map((j) => j.id).sort(), ["newest", "old_q2", "old_other_block", "old_queued", "recent"].sort());
  });

  it("deletes HLS versions no block uses once they are a day old", async () => {
    await seed([video("blk_tq", { hlsUrl: "/uploads/videos/les_tq/blk_tq/hls/keep/master.m3u8", storageKey: KEY })]);
    const base = path.join(uploadRoot(), "videos", "les_tq", "blk_tq", "hls");
    const old = new Date(Date.now() - 3 * 86_400_000);
    for (const v of ["keep", "orphan", "fresh"]) {
      mkdirSync(path.join(base, v, "720p"), { recursive: true });
      writeFileSync(path.join(base, v, "master.m3u8"), "#EXTM3U\n");
      writeFileSync(path.join(base, v, "720p", "seg_00000.m4s"), "x");
      if (v !== "fresh") utimesSync(path.join(base, v), old, old);
    }
    const removed = await queue.cleanupOrphanedHls();
    assert.ok(removed >= 1);
    assert.ok(existsSync(path.join(base, "keep", "master.m3u8")));
    assert.ok(existsSync(path.join(base, "fresh", "master.m3u8")));
    assert.ok(!existsSync(path.join(base, "orphan", "master.m3u8")));
  });
});

describe("onVideoReady", () => {
  it("asks for automatic captions without ever throwing", async () => {
    await seed([video("blk_tq")], [], { storage: { transcodeToHls: true, renditions: [720], autoTranscribe: false } });
    await queue.onVideoReady("les_tq", "blk_tq");
    // Automatic captions are off: nothing was queued or written.
    assert.equal((await getDb()).transcripts.length, 0);
    await queue.onVideoReady("les_missing", "blk_missing");
  });
});

describe("/api/cron/media", () => {
  const request = (url: string, headers: Record<string, string> = {}): NextRequest =>
    Object.assign(new Request(url, { headers }), { nextUrl: new URL(url) }) as unknown as NextRequest;

  it("needs the cron key", async () => {
    await seed();
    assert.equal((await cronGET(request("http://localhost:3000/api/cron/media"))).status, 401);
    assert.equal((await cronGET(request("http://localhost:3000/api/cron/media?key=wrong"))).status, 401);
    assert.equal((await cronPOST(request("http://localhost:3000/api/cron/media", { authorization: "Bearer wrong" }))).status, 401);
    assert.equal((await getDb()).transcodeJobs.length, 0);
  });

  it("queues videos that need converting and reports the queue", async () => {
    await seed();
    const response = await cronGET(request(`http://localhost:3000/api/cron/media?key=${cronKey()}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = (await response.json()) as { ok: boolean; queued: number; queue: { queued: number }; errors: string[]; migrated: unknown };
    assert.equal(body.ok, true);
    assert.equal(body.queued, 1);
    assert.equal(body.queue.queued, 1);
    assert.deepEqual(body.errors, []);
    assert.equal(body.migrated, null);

    const bearer = await cronPOST(request("http://localhost:3000/api/cron/media", { authorization: `Bearer ${cronKey()}` }));
    assert.equal(bearer.status, 200);
    assert.equal(((await bearer.json()) as { queued: number }).queued, 0);
  });

  it("marks videos unavailable when ffmpeg is missing", async () => {
    setFfmpeg(false);
    await seed();
    const response = await cronGET(request(`http://localhost:3000/api/cron/media?key=${cronKey()}`));
    assert.equal(((await response.json()) as { queued: number }).queued, 0);
    assert.equal((await block()).transcode?.status, "unavailable");
  });
});

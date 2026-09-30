import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import type { LessonBlock, Transcript } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { parseVtt } from "@/lib/transcripts/format";
import type { TranscriptPayload } from "@/lib/transcripts/panel";
import type { TranscriptSearchResult } from "@/lib/transcripts/search";
import { GET as getTranscript } from "@/app/api/transcripts/[lessonId]/[blockId]/route";
import { GET as searchRoute } from "@/app/api/transcripts/search/route";
import { FIXED_NOW, makeCourseTree, makeEnrollment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

const instructor = makeUser({ id: "usr_tr_instructor", roles: ["course_creator"] });
const learner = makeUser({ id: "usr_tr_learner" });
const searcher = makeUser({ id: "usr_tr_searcher" });

const video = (id: string, transcriptId?: string): LessonBlock => ({ id, type: "video", src: `/uploads/videos/${id}.mp4`, ...(transcriptId ? { transcriptId } : {}) });

const tree = makeCourseTree(
  [
    [
      { id: "les_tr_intro", title: "Intro: Loops & Ranges", blocks: [video("blk_tr_intro", "trn_tr_intro"), video("blk_tr_bare"), video("blk_tr_pending", "trn_tr_pending")] },
      { id: "les_tr_next", title: "Next steps", blocks: [video("blk_tr_next", "trn_tr_next")] },
    ],
  ],
  { course: { id: "crs_tr", slug: "tr-course", title: "Transcripts 101", instructorIds: [instructor.id] } },
);

const transcript = (id: string, lessonId: string, blockId: string, overrides: Partial<Transcript> = {}): Transcript => ({
  id,
  lessonId,
  blockId,
  language: "en",
  cues: [
    { start: 0, end: 4, text: "Welcome to loops" },
    { start: 65, end: 70, text: "Ranges count for you" },
  ],
  source: "auto",
  status: "ready",
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
  ...overrides,
});

async function seed() {
  await resetDb({
    users: [instructor, learner, searcher],
    courses: [tree.course],
    chapters: tree.chapters,
    lessons: tree.lessons,
    enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id }), makeEnrollment({ userId: searcher.id, courseId: tree.course.id })],
    transcripts: [
      transcript("trn_tr_intro", "les_tr_intro", "blk_tr_intro"),
      transcript("trn_tr_pending", "les_tr_intro", "blk_tr_pending", { cues: [], status: "processing" }),
      transcript("trn_tr_next", "les_tr_next", "blk_tr_next", { cues: [{ start: 9, end: 12, text: "More loops ahead" }], source: "manual" }),
    ],
  });
}

async function as(userId: string | null) {
  resetRequest();
  if (userId) await createSession(userId);
}

/** The route handlers read `req.nextUrl`; the test stub's NextRequest is a plain Request. */
function request(path: string, headers: Record<string, string> = {}): NextRequest {
  const url = new URL(path, "https://lms.test");
  return Object.assign(new Request(url, { headers }), { nextUrl: url }) as unknown as NextRequest;
}

function read(lessonId: string, blockId: string, query = "", headers: Record<string, string> = {}) {
  return getTranscript(request(`/api/transcripts/${lessonId}/${blockId}${query}`, headers), { params: Promise.resolve({ lessonId, blockId }) });
}

describe("player-hls: GET /api/transcripts/[lessonId]/[blockId]", () => {
  beforeEach(seed);

  it("gives a learner the transcript for the panel and caption track", async () => {
    await as(learner.id);
    const res = await read("les_tr_intro", "blk_tr_intro");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /private/);
    const body = (await res.json()) as TranscriptPayload;
    assert.equal(body.ok, true);
    assert.equal(body.pending, false);
    assert.equal(body.courseId, "crs_tr");
    assert.equal(body.editHref, null, "learners get no editor link");
    assert.deepEqual(body.transcript, {
      id: "trn_tr_intro",
      language: "en",
      source: "auto",
      updatedAt: FIXED_NOW,
      cues: [
        { start: 0, end: 4, text: "Welcome to loops" },
        { start: 65, end: 70, text: "Ranges count for you" },
      ],
    });
  });

  it("revalidates with an ETag instead of sending the transcript again", async () => {
    await as(learner.id);
    const first = await read("les_tr_intro", "blk_tr_intro");
    const etag = first.headers.get("etag");
    assert.ok(etag);
    const again = await read("les_tr_intro", "blk_tr_intro", "", { "if-none-match": etag });
    assert.equal(again.status, 304);
    assert.equal(await again.text(), "");
  });

  it("answers with no transcript for a video that has none, and hides unfinished ones from learners", async () => {
    await as(learner.id);
    for (const blockId of ["blk_tr_bare", "blk_tr_pending"]) {
      const body = (await (await read("les_tr_intro", blockId)).json()) as TranscriptPayload;
      assert.equal(body.transcript, null, blockId);
      assert.equal(body.pending, false, blockId);
    }
  });

  it("tells course managers about a transcript being generated and links the editor", async () => {
    await as(instructor.id);
    const pending = (await (await read("les_tr_intro", "blk_tr_pending")).json()) as TranscriptPayload;
    assert.equal(pending.transcript, null);
    assert.equal(pending.pending, true);
    assert.equal(pending.editHref, "/admin/courses/crs_tr/lessons/les_tr_intro/transcript?block=blk_tr_pending");
    const ready = await read("les_tr_intro", "blk_tr_intro");
    assert.equal(((await ready.json()) as TranscriptPayload).editHref, "/admin/courses/crs_tr/lessons/les_tr_intro/transcript?block=blk_tr_intro");

    await as(learner.id);
    const learnerTag = (await read("les_tr_intro", "blk_tr_intro")).headers.get("etag");
    assert.notEqual(ready.headers.get("etag"), learnerTag, "a manager's cached copy is never reused for a learner");
  });

  it("refuses visitors who cannot play the video", async () => {
    await as(null);
    const guest = await read("les_tr_intro", "blk_tr_intro");
    assert.equal(guest.status, 401);
    assert.equal(((await guest.json()) as { ok: boolean }).ok, false);
    assert.equal((await read("les_tr_intro", "blk_tr_intro", "?format=vtt")).status, 401);
    assert.equal((await read("les_missing", "blk_tr_intro")).status, 404);
  });

  it("downloads the transcript as WebVTT, SubRip and plain text", async () => {
    await as(learner.id);
    const vtt = await read("les_tr_intro", "blk_tr_intro", "?format=vtt");
    assert.equal(vtt.status, 200);
    assert.match(vtt.headers.get("content-type") ?? "", /^text\/vtt/);
    assert.equal(vtt.headers.get("content-disposition"), 'attachment; filename="intro-loops-ranges-transcript.vtt"');
    assert.equal(parseVtt(await vtt.text()).cues.length, 2);

    const srt = await read("les_tr_intro", "blk_tr_intro", "?format=SRT");
    assert.match(await srt.text(), /^1\n00:00:00,000 --> 00:00:04,000\nWelcome to loops\n/);
    assert.match(srt.headers.get("content-disposition") ?? "", /\.srt"$/);

    const txt = await read("les_tr_intro", "blk_tr_intro", "?format=txt");
    assert.match(txt.headers.get("content-type") ?? "", /^text\/plain/);
    const text = await txt.text();
    assert.ok(text.startsWith("Intro: Loops & Ranges\n"));
    assert.ok(text.includes("[0:00] Welcome to loops\n[1:05] Ranges count for you\n"));
  });

  it("rejects unknown formats and downloads of a missing transcript", async () => {
    await as(learner.id);
    assert.equal((await read("les_tr_intro", "blk_tr_intro", "?format=docx")).status, 400);
    assert.equal((await read("les_tr_intro", "blk_tr_bare", "?format=vtt")).status, 404);
    assert.equal((await read("les_tr_intro", "blk_tr_pending", "?format=txt")).status, 404);
  });
});

describe("player-hls: GET /api/transcripts/search", () => {
  beforeEach(seed);

  const search = async (query: string) => {
    const res = await searchRoute(request(`/api/transcripts/search${query}`));
    return { res, body: (await res.json()) as { ok: boolean; query?: string; error?: string; results?: TranscriptSearchResult[] } };
  };

  it("returns the lessons a learner can open with links to each match", async () => {
    await as(learner.id);
    const { res, body } = await search("?q=LOOPS");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    assert.equal(body.query, "LOOPS");
    assert.deepEqual(
      body.results!.map((r) => [r.lessonTitle, r.href, r.matches.map((m) => m.href)]),
      [
        ["Intro: Loops & Ranges", "/courses/tr-course/learn/1-1?t=0", ["/courses/tr-course/learn/1-1?t=0"]],
        ["Next steps", "/courses/tr-course/learn/1-2?t=9", ["/courses/tr-course/learn/1-2?t=9"]],
      ],
    );
  });

  it("scopes to a course, honours the limit and returns nothing for short or unknown queries", async () => {
    await as(learner.id);
    assert.equal((await search("?q=loops&limit=1")).body.results!.length, 1);
    assert.equal((await search("?q=loops&courseId=crs_other")).body.results!.length, 0);
    assert.equal((await search("?q=loops&courseId=crs_tr")).body.results!.length, 2);
    assert.deepEqual((await search("?q=l")).body, { ok: true, query: "l", results: [] });
    assert.deepEqual((await search("")).body, { ok: true, query: "", results: [] });
    assert.equal((await search("?q=zebra")).body.results!.length, 0);
  });

  it("shows signed-out visitors nothing from lessons that need an enrollment", async () => {
    await as(null);
    const { res, body } = await search("?q=loops");
    assert.equal(res.status, 200);
    assert.deepEqual(body.results, []);
  });

  it("limits how fast one member can search", async () => {
    await as(searcher.id);
    for (let i = 0; i < 60; i++) assert.equal((await search("?q=ranges")).res.status, 200, `search ${i + 1}`);
    const { res, body } = await search("?q=ranges");
    assert.equal(res.status, 429);
    assert.equal(body.ok, false);
    assert.ok(Number(res.headers.get("retry-after")) >= 1);
    // Queries too short to run are not counted and other members are unaffected.
    assert.equal((await search("?q=r")).res.status, 200);
    await as(learner.id);
    assert.equal((await search("?q=ranges")).res.status, 200);
  });
});

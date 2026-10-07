import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Database, Enrollment, LessonProgress, VideoWatch } from "@/lib/types";
import { COLLECTIONS } from "@/lib/db/store";
import { StoreEngine } from "@/lib/db/engine";
import { SqliteDriver } from "@/lib/db/sqlite";
import { createDatabaseFile, openDatabase, type RawData } from "@/lib/db/sqlite-core.mjs";

/**
 * data-sqlite: "handles thousands of students without slowing down".
 *
 * A school-sized SQLite file — 5,000 learners, 50 courses with 1,000
 * lessons, 50,000 enrollments, 100,000 lesson-progress rows and 100,000
 * video-progress rows (about 256,000 documents) — opened by the real engine
 * and driver, then:
 *
 *  1. cold load: open, `PRAGMA quick_check`, migrations for every
 *     collection, reading every document and fingerprinting it;
 *  2. 1,000 sequential heartbeat-style mutations, each finding and changing
 *     one row and then written to disk on its own (candidates mode: exactly
 *     one document compared and one row upserted per mutation);
 *  3. a burst of 1,000 concurrent heartbeats, coalesced into a few
 *     transactions;
 *  4. a full background sweep of every collection, which must leave the
 *     event loop free between short slices.
 *
 * The numbers are printed as test diagnostics and summarized in DEPLOYMENT.md
 * ("Sizing") and on /admin/settings/data. The bounds below are several
 * times what a laptop measures, so a busy CI machine still passes while a
 * regression to whole-collection work per heartbeat fails.
 */

const USERS = 5_000;
const COURSES = 50;
const CHAPTERS_PER_COURSE = 5;
const LESSONS_PER_CHAPTER = 4;
const ENROLLMENTS_PER_USER = 10;
/** Lesson-progress and video-progress rows per enrollment (each). */
const ROWS_PER_ENROLLMENT = 2;
const HEARTBEATS = 1_000;

const BUDGET = {
  /** Opening the database and loading every document into memory. */
  coldLoadMs: 20_000,
  /** One heartbeat: the mutation plus its own transaction. */
  heartbeatP95Ms: 15,
  /** The longest the sweep may hold the event loop at once. */
  sweepSliceMs: 50,
};

let dir: string;
let file: string;
let engine: StoreEngine | null = null;
let seeded: { data: RawData; seedMs: number; documents: number };
const report: Record<string, string> = {};

const lessonsPerCourse = CHAPTERS_PER_COURSE * LESSONS_PER_CHAPTER;
const userId = (i: number) => `usr_s${i.toString(36).padStart(4, "0")}`;
const courseId = (c: number) => `crs_s${c}`;
const lessonId = (c: number, l: number) => `les_s${c}_${l}`;
const blockId = (c: number, l: number) => `blk_${c}_${l}`;

/** Deterministic pseudo-random numbers (mulberry32), so every run builds the same school. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The value below which `p` (0–1) of the samples fall (nearest rank). */
/** The main thread's CPU time in ms (Node 23.9+), or null where Node cannot measure it. */
function threadCpuMs(): number | null {
  const read = (process as unknown as { threadCpuUsage?: () => { user: number; system: number } }).threadCpuUsage;
  if (typeof read !== "function") return null;
  const usage = read.call(process);
  return (usage.user + usage.system) / 1000;
}

/**
 * Records how much main-thread CPU time each sweep slice uses. The engine
 * times slices by the wall clock, which another process can stretch by
 * taking the CPU away mid-slice; CPU time only counts the work the slice did.
 * (Windows counts thread CPU time in ~15.6 ms ticks, well inside the 50 ms budget.)
 */
function recordSliceCpu(e: StoreEngine): { longest: () => number | null; reset: () => void; restore: () => void } {
  const internals = e as unknown as { sweepSlice: (cursor: unknown) => { ok: boolean; ms: number } };
  const original = internals.sweepSlice;
  let longest: number | null = null;
  internals.sweepSlice = function (this: unknown, cursor: unknown) {
    const before = threadCpuMs();
    const result = original.call(this, cursor);
    const afterMs = threadCpuMs();
    if (before !== null && afterMs !== null) longest = Math.max(longest ?? 0, afterMs - before);
    return result;
  };
  return {
    longest: () => longest,
    reset: () => {
      longest = null;
    },
    restore: () => {
      internals.sweepSlice = original;
    },
  };
}

function percentile(samples: readonly number[], p: number): number {
  if (!samples.length) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank]!;
}

const ms = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(0)} ms`;

/** Enrollment `e` of user `u`: the courses are spread so every course has 1,000 learners. */
function enrolledCourse(u: number, e: number): number {
  return (u + e * Math.floor(COURSES / ENROLLMENTS_PER_USER)) % COURSES;
}

function buildSchool(): RawData {
  const rnd = random(20261005);
  const now = Date.UTC(2026, 9, 5, 12);
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const collections: Record<string, unknown[]> = {};
  for (const name of COLLECTIONS) collections[name] = [];

  for (let u = 0; u < USERS; u++) {
    collections.users!.push({
      id: userId(u),
      username: `learner${u}`,
      name: `Learner ${u}`,
      email: `learner${u}@school.example`,
      // The shape of a real scrypt hash, so documents have a realistic size.
      passwordHash: `scrypt$16384$8$1$${Buffer.from(`salt-${u}`).toString("base64")}$${"x".repeat(86)}`,
      roles: ["student"],
      headline: u % 7 === 0 ? "Data analyst learning to code" : undefined,
      createdAt: iso(Math.floor(rnd() * 400)),
      lastActiveAt: iso(Math.floor(rnd() * 30)),
    });
  }
  for (let c = 0; c < COURSES; c++) {
    collections.courses!.push({
      id: courseId(c),
      slug: `course-${c}`,
      title: `Course ${c}: practical skills`,
      shortIntroduction: "A hands-on course with video lessons, quizzes and a final project.",
      instructorIds: ["usr_instructor"],
      published: true,
      paid: c % 3 === 0,
      price: c % 3 === 0 ? 49 : 0,
      currency: "USD",
      createdAt: iso(500),
      updatedAt: iso(10),
    });
    for (let ch = 0; ch < CHAPTERS_PER_COURSE; ch++) {
      collections.chapters!.push({ id: `chp_s${c}_${ch}`, courseId: courseId(c), title: `Chapter ${ch + 1}`, position: ch });
      for (let l = 0; l < LESSONS_PER_CHAPTER; l++) {
        const index = ch * LESSONS_PER_CHAPTER + l;
        collections.lessons!.push({
          id: lessonId(c, index),
          courseId: courseId(c),
          chapterId: `chp_s${c}_${ch}`,
          slug: `lesson-${index + 1}`,
          title: `Lesson ${index + 1}`,
          position: l,
          blocks: [
            { id: blockId(c, index), type: "video", source: `/uploads/videos/${c}-${index}.mp4`, duration: 300 + index * 20 },
            { id: `txt_${c}_${index}`, type: "markdown", content: "Notes for this lesson, with a short summary and links." },
          ],
        });
      }
    }
  }

  for (let u = 0; u < USERS; u++) {
    for (let e = 0; e < ENROLLMENTS_PER_USER; e++) {
      const c = enrolledCourse(u, e);
      const enrollment: Enrollment = {
        id: `enr_s${u}_${e}`,
        userId: userId(u),
        courseId: courseId(c),
        memberType: "student",
        enrolledAt: iso(Math.floor(rnd() * 300)),
        progress: Math.floor(rnd() * 100),
        currentLessonId: lessonId(c, (u + e) % lessonsPerCourse),
        purchasedCertificate: false,
      };
      collections.enrollments!.push(enrollment);
      for (let r = 0; r < ROWS_PER_ENROLLMENT; r++) {
        const l = (u + e + r * 7) % lessonsPerCourse;
        const updatedAt = iso(Math.floor(rnd() * 60));
        const progress: LessonProgress = {
          id: `prg_s${u}_${e}_${r}`,
          userId: userId(u),
          courseId: courseId(c),
          chapterId: `chp_s${c}_${Math.floor(l / LESSONS_PER_CHAPTER)}`,
          lessonId: lessonId(c, l),
          status: r === 0 ? "complete" : "partial",
          dwellSeconds: Math.floor(rnd() * 900),
          completedAt: r === 0 ? updatedAt : undefined,
          updatedAt,
        };
        collections.progress!.push(progress);
        const duration = 300 + l * 20;
        const watched = Math.floor(rnd() * duration);
        const watch: VideoWatch = {
          id: `vw_s${u}_${e}_${r}`,
          userId: userId(u),
          courseId: courseId(c),
          lessonId: lessonId(c, l),
          blockId: blockId(c, l),
          source: `/uploads/videos/${c}-${l}.mp4`,
          watchSeconds: watched,
          lastPositionSeconds: watched,
          maxPositionSeconds: watched,
          durationSeconds: duration,
          completed: watched > duration * 0.9,
          updatedAt,
        };
        collections.videoWatches!.push(watch);
      }
    }
  }
  return { collections, settings: { siteName: "Scale test school" } };
}

function normalize(data: RawData): Database {
  const db: Record<string, unknown> = {};
  for (const name of COLLECTIONS) db[name] = data.collections[name] ?? [];
  db.settings = data.settings ?? { siteName: "Scale test school" };
  return db as unknown as Database;
}

function openEngine(): StoreEngine {
  const driver = new SqliteDriver({ file, collections: COLLECTIONS });
  engine = new StoreEngine({
    driver,
    collections: COLLECTIONS,
    normalize,
    initialData: async () => {
      throw new Error("The scale database was seeded before the engine opened it.");
    },
    flushDelayMs: 25,
    // Sweeps run when the test asks for them, not in the middle of the timings.
    sweepDelayMs: 10 * 60_000,
  });
  return engine;
}

/** The stored JSON of one row, through a separate read-only connection (what a restart would load). */
function storedDoc(collection: string, id: string): unknown {
  const conn = openDatabase(file, { readOnly: true });
  try {
    const row = conn.prepare(`SELECT doc FROM "${collection}" WHERE id = ?`).get(id);
    return row ? JSON.parse(String(row.doc)) : null;
  } finally {
    conn.close();
  }
}

/** Heartbeat `i`: which existing row it updates (spread over the whole school). */
function heartbeatTarget(i: number): { u: number; e: number; r: number; c: number; l: number } {
  const u = (i * 7_919) % USERS;
  const e = (i * 31) % ENROLLMENTS_PER_USER;
  const r = i % ROWS_PER_ENROLLMENT;
  const c = enrolledCourse(u, e);
  return { u, e, r, c, l: (u + e + r * 7) % lessonsPerCourse };
}

/** What the video-progress and lesson-progress routes do per heartbeat: find the learner's row, change it. */
function heartbeat(db: Database, i: number, nowMs: number): string {
  const t = heartbeatTarget(i);
  const uid = userId(t.u);
  const lid = lessonId(t.c, t.l);
  if (i % 2 === 0) {
    const bid = blockId(t.c, t.l);
    const row = db.videoWatches.find((w) => w.userId === uid && w.lessonId === lid && w.blockId === bid);
    assert.ok(row, `video row for heartbeat ${i}`);
    row.watchSeconds += 5;
    row.lastPositionSeconds = Math.min(row.durationSeconds, row.lastPositionSeconds + 5);
    row.maxPositionSeconds = Math.max(row.maxPositionSeconds, row.lastPositionSeconds);
    row.updatedAt = new Date(nowMs).toISOString();
    return row.id;
  }
  const row = db.progress.find((p) => p.userId === uid && p.lessonId === lid);
  assert.ok(row, `progress row for heartbeat ${i}`);
  row.dwellSeconds += 15;
  row.updatedAt = new Date(nowMs).toISOString();
  return row.id;
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-scale-"));
  file = path.join(dir, "lms.sqlite");
  const data = buildSchool();
  const started = performance.now();
  createDatabaseFile(file, data, { collections: COLLECTIONS, source: "scale-test" });
  const documents = Object.values(data.collections).reduce((n, docs) => n + docs.length, 0);
  seeded = { data, seedMs: performance.now() - started, documents };
});

after(() => {
  engine?.close();
  engine = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SQLite store at school scale (5,000 learners, ~256,000 documents)", () => {
  it("builds the school in one transaction", (ctx) => {
    const { collections } = seeded.data;
    assert.equal(collections.users!.length, USERS);
    assert.equal(collections.enrollments!.length, USERS * ENROLLMENTS_PER_USER);
    assert.equal(collections.progress!.length + collections.videoWatches!.length, USERS * ENROLLMENTS_PER_USER * ROWS_PER_ENROLLMENT * 2);
    const size = fs.statSync(file).size;
    report.seed = `${seeded.documents.toLocaleString("en")} documents written in ${ms(seeded.seedMs)}, file ${(size / 1024 / 1024).toFixed(0)} MB`;
    ctx.diagnostic(report.seed);
    // The seed data is not needed any more: let it be collected before the timings.
    seeded.data = { collections: {}, settings: null };
  });

  it("loads cold within budget", async (ctx) => {
    const started = performance.now();
    const db = await openEngine().getDb();
    const loadMs = performance.now() - started;
    assert.equal(db.users.length, USERS);
    assert.equal(db.enrollments.length, USERS * ENROLLMENTS_PER_USER);
    assert.equal(db.progress.length, USERS * ENROLLMENTS_PER_USER * ROWS_PER_ENROLLMENT);
    assert.equal(db.videoWatches.length, USERS * ENROLLMENTS_PER_USER * ROWS_PER_ENROLLMENT);
    const stats = engine!.getStats();
    assert.equal(stats.origin, "existing");
    assert.equal(stats.loadedDocuments, seeded.documents);
    assert.ok(stats.loadMs !== null && stats.loadMs <= Math.ceil(loadMs));
    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    report.load = `cold load ${ms(loadMs)} (${seeded.documents.toLocaleString("en")} documents; ${heapMb.toFixed(0)} MB of heap in use afterwards)`;
    ctx.diagnostic(report.load);
    assert.ok(loadMs < BUDGET.coldLoadMs, `cold load took ${ms(loadMs)}`);
  });

  it("persists 1,000 sequential heartbeats one document per transaction, with a bounded p95", async (ctx) => {
    const e = engine!;
    const latencies: number[] = [];
    const touched = new Map<string, string>();
    // A few warm-up beats so JIT compilation is not part of the samples.
    for (let i = 0; i < 20; i++) {
      await e.mutate((db) => heartbeat(db, HEARTBEATS + i, Date.now()));
      await e.writePending();
    }
    const base = e.getStats();
    for (let i = 0; i < HEARTBEATS; i++) {
      const before = e.getStats();
      const started = performance.now();
      const id = await e.mutate((db) => heartbeat(db, i, Date.now()));
      assert.equal(await e.writePending(), true);
      latencies.push(performance.now() - started);
      touched.set(id, i % 2 === 0 ? "videoWatches" : "progress");
      const now = e.getStats();
      // Candidates mode: only the document the heartbeat found was serialized, and it was written in its own transaction.
      assert.equal(now.documentsCompared - before.documentsCompared, 1, `heartbeat ${i} compared one document`);
      assert.equal(now.documentsWritten - before.documentsWritten, 1, `heartbeat ${i} wrote one row`);
      assert.equal(now.flushes - before.flushes, 1, `heartbeat ${i} was its own transaction`);
    }
    const stats = e.getStats();
    assert.equal(stats.flushes - base.flushes, HEARTBEATS);
    assert.equal(stats.pending, false);
    assert.equal(stats.lastError, null);

    // What a restart would load equals memory for the rows the heartbeats changed.
    const db = await e.getDb();
    for (const [id, collection] of [...touched].filter((_, n) => n % 50 === 0)) {
      const memory = (collection === "videoWatches" ? db.videoWatches : db.progress).find((d) => d.id === id);
      assert.deepEqual(storedDoc(collection, id), JSON.parse(JSON.stringify(memory)), `${collection}/${id} is on disk`);
    }

    const p50 = percentile(latencies, 0.5);
    const p95 = percentile(latencies, 0.95);
    const p99 = percentile(latencies, 0.99);
    report.heartbeats = `${HEARTBEATS} sequential heartbeats, each written in its own transaction: p50 ${ms(p50)}, p95 ${ms(p95)}, p99 ${ms(p99)}, max ${ms(Math.max(...latencies))}`;
    ctx.diagnostic(report.heartbeats);
    assert.ok(p95 < BUDGET.heartbeatP95Ms, `p95 heartbeat latency was ${ms(p95)}`);
  });

  it("coalesces a burst of 1,000 concurrent heartbeats into a few transactions", async (ctx) => {
    const e = engine!;
    const before = e.getStats();
    const started = performance.now();
    const ids = await Promise.all(Array.from({ length: HEARTBEATS }, (_, i) => e.mutate((db) => heartbeat(db, i % 400, Date.now()))));
    const appliedMs = performance.now() - started;
    // The coalesced write fires on its own timer.
    const deadline = Date.now() + 10_000;
    while (e.getStats().pending && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const totalMs = performance.now() - started;
    const stats = e.getStats();
    const distinct = new Set(ids).size;
    const flushes = stats.flushes - before.flushes;
    assert.equal(stats.pending, false, "the burst was written");
    assert.ok(flushes >= 1 && flushes <= 3, `the burst took ${flushes} transactions`);
    assert.ok(stats.documentsWritten - before.documentsWritten >= distinct);
    assert.ok(stats.documentsWritten - before.documentsWritten <= distinct * flushes);
    assert.ok(stats.documentsCompared - before.documentsCompared <= distinct * flushes, "only the touched documents were compared");
    report.burst = `${HEARTBEATS} concurrent heartbeats on ${distinct} rows applied in ${ms(appliedMs)} and stored in ${flushes} transaction(s) of ${distinct} rows, ${ms(totalMs)} including the ${25} ms coalescing delay`;
    ctx.diagnostic(report.burst);
  });

  it("sweeps every collection in short slices without blocking the event loop", async (ctx) => {
    const e = engine!;
    const db = await e.getDb();
    // An edit the engine cannot see (a document kept from outside mutate()): only the sweep stores it.
    const hidden = db.enrollments.find((x) => x.id === "enr_s4999_9")!;
    hidden.progress = 100;
    const untrackedBefore = e.getStats().untrackedWrites;

    // An independent probe: how late a 1 ms timer fires while the sweep runs.
    const delay = monitorEventLoopDelay({ resolution: 1 });
    const gaps: number[] = [];
    let probing = true;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (probing) setTimeout(tick, 1);
    };
    setTimeout(tick, 1);
    delay.enable();
    const sweep = await e.sweepNow(COLLECTIONS);
    delay.disable();
    probing = false;

    assert.ok(sweep, "the sweep ran");
    assert.equal(sweep.complete, true);
    assert.equal(sweep.collections, COLLECTIONS.length);
    assert.ok(sweep.documents >= seeded.documents, `compared ${sweep.documents} documents`);
    assert.ok(sweep.slices > 10, `ran in ${sweep.slices} slices`);
    assert.equal(e.getStats().untrackedWrites - untrackedBefore, 1, "the hidden edit was found and stored");
    assert.equal((storedDoc("enrollments", "enr_s4999_9") as Enrollment).progress, 100);
    assert.ok(gaps.length > sweep.slices / 4, `the event loop ran timers ${gaps.length} times during ${sweep.slices} slices`);

    const stats = e.getStats();
    assert.equal(stats.lastSweepDocuments, sweep.documents);
    const p99Gap = percentile(gaps, 0.99);
    report.sweep =
      `full sweep of ${sweep.documents.toLocaleString("en")} documents: ${sweep.slices} slices, ${ms(sweep.busyMs)} busy over ${ms(sweep.wallMs)}, ` +
      `longest slice ${ms(sweep.maxSliceMs)}; timer probe p99 ${ms(p99Gap)}, event-loop delay p99 ${ms(delay.percentile(99) / 1e6)} (max ${ms(delay.max / 1e6)}, includes GC)`;
    ctx.diagnostic(report.sweep);
    // Slices are timed by the wall clock, so a busy machine (the full suite runs files in
    // parallel) can stretch one. A real regression is slow every time: retry up to twice and
    // judge the best run, by the wall clock or, where Node can measure it, by the CPU time the
    // slice itself used (a slice doing too much work uses too much CPU however idle the machine).
    let longestSlice = sweep.maxSliceMs;
    let longestSliceCpu: number | null = null;
    const cpu = recordSliceCpu(e);
    try {
      for (let retry = 0; retry < 2 && longestSlice >= BUDGET.sweepSliceMs && (longestSliceCpu ?? Infinity) >= BUDGET.sweepSliceMs; retry++) {
        cpu.reset();
        const again = await e.sweepNow(COLLECTIONS);
        if (!again?.complete) continue;
        longestSlice = Math.min(longestSlice, again.maxSliceMs);
        const againCpu = cpu.longest();
        if (againCpu !== null) longestSliceCpu = Math.min(longestSliceCpu ?? Infinity, againCpu);
      }
    } finally {
      cpu.restore();
    }
    assert.ok(
      longestSlice < BUDGET.sweepSliceMs || (longestSliceCpu !== null && longestSliceCpu < BUDGET.sweepSliceMs),
      `the longest sweep slice took ${ms(longestSlice)}` + (longestSliceCpu === null ? "" : ` (${ms(longestSliceCpu)} of CPU time)`),
    );
    assert.ok(p99Gap < BUDGET.sweepSliceMs * 2, `timers were held up to ${ms(p99Gap)} (p99)`);
  });

  it("percentile() picks the nearest rank", () => {
    assert.ok(Number.isNaN(percentile([], 0.5)));
    assert.equal(percentile([5], 0.95), 5);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5);
    assert.equal(percentile([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 0.95), 10);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
    assert.equal(percentile([3, 1, 2], 0), 1);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NetworkError,
  UploadTask,
  discardPendingUpload,
  listPendingUploads,
  type HttpRequest,
  type HttpResult,
  type UploadEnvironment,
  type UploadPhase,
  type UploadSnapshot,
} from "@/lib/media/resumable-client";
import { MAX_CHUNK_RETRIES, resumeKeyFor } from "@/lib/media/resumable-shared";

/** The browser upload engine against an in-memory fake of the `/api/uploads` protocol. */

const CHUNK = 256 * 1024;

interface FakeSession {
  size: number;
  data: Uint8Array[];
  received: number;
  status: "uploading" | "complete" | "aborted";
}

type Fault = (req: HttpRequest, server: FakeServer) => Promise<HttpResult | "pass"> | HttpResult | "pass";

function result(status: number, body: Record<string, unknown> | null = null, headers: Record<string, string> = {}): HttpResult {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, body, header: (name) => lower.get(name.toLowerCase()) ?? null };
}

class FakeServer {
  sessions = new Map<string, FakeSession>();
  log: string[] = [];
  faults: Fault[] = [];
  simpleUploads = 0;
  private next = 0;

  bytesOf(id: string): Uint8Array {
    const s = this.sessions.get(id)!;
    const out = new Uint8Array(s.received);
    let o = 0;
    for (const part of s.data) {
      out.set(part, o);
      o += part.byteLength;
    }
    return out;
  }

  /** Append bytes as if they arrived (used by faults simulating a partial chunk). */
  append(id: string, bytes: Uint8Array): void {
    const s = this.sessions.get(id)!;
    s.data.push(bytes);
    s.received += bytes.byteLength;
  }

  transport = async (req: HttpRequest): Promise<HttpResult> => {
    if (req.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    this.log.push(`${req.method} ${req.url}`);
    const fault = this.faults.shift();
    if (fault) {
      const r = await fault(req, this);
      if (r !== "pass") return r;
    }
    return this.handle(req);
  };

  private async handle(req: HttpRequest): Promise<HttpResult> {
    if (req.method === "POST" && req.url === "/api/upload") {
      this.simpleUploads++;
      const file = (req.body as FormData).get("file") as File;
      req.onUploadProgress?.(file.size);
      return result(200, { ok: true, url: `/uploads/${file.name}`, name: file.name, size: file.size, type: file.type });
    }
    if (req.method === "POST" && req.url === "/api/uploads") {
      const input = JSON.parse(String(req.body)) as { size: number };
      const id = `ups_fake${String(++this.next).padStart(8, "0")}`;
      this.sessions.set(id, { size: input.size, data: [], received: 0, status: "uploading" });
      return result(201, { ok: true, id, chunkSize: CHUNK, offset: 0 });
    }
    const m = /^\/api\/uploads\/(ups_[a-z0-9]+)(\/complete)?$/.exec(req.url);
    const session = m ? this.sessions.get(m[1]!) : undefined;
    if (!m || !session || session.status === "aborted") return result(req.method === "HEAD" ? 404 : 404, { ok: false, error: "This upload does not exist." });
    const id = m[1]!;
    const offsetHeaders = { "Upload-Offset": String(session.received), "Upload-Length": String(session.size), "Upload-Status": session.status };
    if (req.method === "HEAD") return result(200, null, offsetHeaders);
    if (req.method === "DELETE") {
      session.status = "aborted";
      return result(200, { ok: true });
    }
    if (req.method === "PATCH") {
      const offset = Number(req.headers?.["Upload-Offset"]);
      if (offset !== session.received) return result(409, { ok: false, error: "wrong offset" }, { "Upload-Offset": String(session.received) });
      const bytes = new Uint8Array(await (req.body as Blob).arrayBuffer());
      req.onUploadProgress?.(bytes.byteLength / 2);
      req.onUploadProgress?.(bytes.byteLength);
      this.append(id, bytes);
      return result(200, { ok: true, offset: session.received }, { "Upload-Offset": String(session.received) });
    }
    if (req.method === "POST" && m[2]) {
      if (session.received !== session.size) return result(409, { ok: false, error: "missing bytes" }, { "Upload-Offset": String(session.received) });
      session.status = "complete";
      return result(200, { ok: true, url: `/uploads/videos/${id}.mp4`, name: "lecture.mp4", size: session.size, type: "video/mp4" });
    }
    return result(405);
  }
}

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

interface Harness {
  server: FakeServer;
  storage: MemoryStorage;
  env: UploadEnvironment;
  sleeps: number[];
  online: { value: boolean; waits: number };
}

function harness(server = new FakeServer(), storage = new MemoryStorage()): Harness {
  const sleeps: number[] = [];
  const online = { value: true, waits: 0 };
  let clock = 1_700_000_000_000;
  const env: UploadEnvironment = {
    transport: server.transport,
    storage,
    sleep: async (ms, signal) => {
      sleeps.push(ms);
      if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
    isOnline: () => online.value,
    waitForOnline: async () => {
      online.waits++;
      online.value = true;
    },
    now: () => (clock += 50),
  };
  return { server, storage, env, sleeps, online };
}

function videoFile(size = CHUNK * 2 + 1234, name = "lecture.mp4"): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7) % 256;
  return new File([bytes], name, { type: "video/mp4", lastModified: 42 });
}

async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Start a task and resolve once it reaches one of `phases`. */
function runUntil(task: UploadTask, phases: UploadPhase[]): Promise<UploadSnapshot> {
  return new Promise((resolve) => {
    const check = () => {
      if (phases.includes(task.snapshot.phase)) resolve(task.snapshot);
      else setTimeout(check, 1);
    };
    check();
  });
}

function makeTask(h: Harness, file: File, extra: { kind?: "video" | "auto" | "document"; scope?: string } = {}) {
  const snapshots: UploadSnapshot[] = [];
  const completed: { url: string }[] = [];
  const task = new UploadTask({
    file,
    kind: extra.kind ?? "video",
    scope: extra.scope ?? "video:videoUrl",
    env: h.env,
    onUpdate: (s) => snapshots.push(s),
    onComplete: (f) => completed.push(f),
  });
  return { task, snapshots, completed };
}

describe("UploadTask (chunked)", () => {
  it("sends the file in chunks, completes and forgets the resume record", async () => {
    const h = harness();
    const file = videoFile();
    const { task, snapshots, completed } = makeTask(h, file);
    assert.equal(task.chunked, true);
    task.start();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done", final.error ?? "");
    assert.equal(completed.length, 1);
    assert.match(completed[0]!.url, /^\/uploads\/videos\/ups_fake/);
    const id = [...h.server.sessions.keys()][0]!;
    assert.deepEqual(h.server.bytesOf(id), await fileBytes(file));
    assert.equal(h.server.log.filter((l) => l.startsWith("PATCH")).length, 3);
    assert.equal(h.storage.length, 0);
    // Progress never goes backwards.
    const loaded = snapshots.map((s) => s.loaded);
    assert.deepEqual(loaded, [...loaded].sort((a, b) => a - b));
  });

  it("recovers from a connection dropped mid-chunk without resending what arrived", async () => {
    const h = harness();
    const file = videoFile();
    const bytes = await fileBytes(file);
    let patches = 0;
    const dropSecond: Fault = async (req, server): Promise<HttpResult | "pass"> => {
      if (req.method !== "PATCH" || ++patches !== 2) {
        h.server.faults.unshift(dropSecond);
        return "pass";
      }
      // Half of the chunk reached the server before the connection died.
      const id = /ups_[a-z0-9]+/.exec(req.url)![0];
      const chunk = new Uint8Array(await (req.body as Blob).arrayBuffer());
      server.append(id, chunk.subarray(0, 1000));
      throw new NetworkError();
    };
    h.server.faults.push(dropSecond);
    const { task, snapshots } = makeTask(h, file);
    task.start();
    const final = await runUntil(task, ["done", "error"]);
    h.server.faults.length = 0;
    assert.equal(final.phase, "done", final.error ?? "");
    const id = [...h.server.sessions.keys()][0]!;
    assert.deepEqual(h.server.bytesOf(id), bytes);
    assert.equal(h.sleeps.length, 1, "one backoff wait");
    assert.ok(h.server.log.some((l) => l.startsWith("HEAD")), "offset re-synced with HEAD");
    assert.ok(snapshots.some((s) => s.phase === "retrying" && s.attempt === 1));
  });

  it("continues from the server's offset after a 409", async () => {
    const h = harness();
    const file = videoFile();
    const bytes = await fileBytes(file);
    const { task } = makeTask(h, file);
    h.server.faults.push(() => "pass"); // POST create
    h.server.faults.push((req, server) => {
      // An earlier request the client never heard back from already delivered 5000 bytes.
      const id = /ups_[a-z0-9]+/.exec(req.url)![0];
      server.append(id, bytes.slice(0, 5000));
      return "pass";
    });
    task.start();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done");
    assert.equal(h.sleeps.length, 0);
    const id = [...h.server.sessions.keys()][0]!;
    assert.deepEqual(h.server.bytesOf(id), bytes);
    // The refused chunk, then two chunks from byte 5000 cover the rest.
    assert.equal(h.server.log.filter((l) => l.startsWith("PATCH")).length, 3);
  });

  it("stops without retrying on a refused file", async () => {
    const h = harness();
    h.server.faults.push(() => result(415, { ok: false, error: "Unsupported file type: video/x-flv" }));
    const { task } = makeTask(h, videoFile());
    task.start();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "error");
    assert.equal(final.error, "Unsupported file type: video/x-flv");
    assert.equal(final.canResume, false);
    assert.equal(h.sleeps.length, 0);
  });

  it("keeps the server's error code so the field can translate it, and stops on a full disk", async () => {
    const quota = harness();
    quota.server.faults.push(() => result(429, { ok: false, error: "You can upload up to 500 MB per day and have used 499 MB.", code: "quota" }));
    const a = makeTask(quota, videoFile());
    a.task.start();
    const aFinal = await runUntil(a.task, ["done", "error"]);
    assert.equal(aFinal.phase, "error");
    assert.equal(aFinal.errorCode, "quota");
    assert.match(aFinal.error ?? "", /500 MB per day/);

    const full = harness();
    full.server.faults.push(() => result(507, { ok: false, error: "The server is running out of storage space.", code: "disk-full" }));
    const b = makeTask(full, videoFile());
    b.task.start();
    const bFinal = await runUntil(b.task, ["done", "error"]);
    assert.equal(bFinal.phase, "error");
    assert.equal(bFinal.errorCode, "disk-full");
    assert.equal(full.sleeps.length, 0, "a full disk is not retried");

    const unknown = harness();
    unknown.server.faults.push(() => result(415, { ok: false, error: "Unsupported file type: video/x-flv", code: "<script>" }));
    const c = makeTask(unknown, videoFile());
    c.task.start();
    const cFinal = await runUntil(c.task, ["done", "error"]);
    assert.equal(cFinal.errorCode, null, "unknown codes are ignored");
  });

  it("treats the unfinished-uploads limit as final but waits out a rate limit", async () => {
    const limited = harness();
    limited.server.faults.push(() => result(429, { ok: false, error: "You have 6 unfinished uploads." }));
    const a = makeTask(limited, videoFile());
    a.task.start();
    const aFinal = await runUntil(a.task, ["done", "error"]);
    assert.equal(aFinal.phase, "error");
    assert.match(aFinal.error ?? "", /6 unfinished/);

    const throttled = harness();
    throttled.server.faults.push(() => result(429, { ok: false, error: "Too many upload requests." }, { "Retry-After": "7" }));
    const b = makeTask(throttled, videoFile());
    b.task.start();
    const bFinal = await runUntil(b.task, ["done", "error"]);
    assert.equal(bFinal.phase, "done");
    assert.deepEqual(throttled.sleeps, [7000]);
  });

  it("gives up after the retry budget and can be resumed later", async () => {
    const h = harness();
    const file = videoFile();
    const failPatch: Fault = (req) => {
      h.server.faults.unshift(failPatch);
      return req.method === "PATCH" ? result(503, { ok: false, error: "Server busy." }) : "pass";
    };
    h.server.faults.push(failPatch);
    const { task } = makeTask(h, file);
    task.start();
    const failed = await runUntil(task, ["done", "error"]);
    assert.equal(failed.phase, "error");
    assert.equal(failed.canResume, true);
    assert.equal(h.sleeps.length, MAX_CHUNK_RETRIES);
    // Delays grow.
    assert.ok(h.sleeps[MAX_CHUNK_RETRIES - 1]! > h.sleeps[0]!);

    h.server.faults.length = 0;
    task.resume();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done");
    assert.equal(h.server.sessions.size, 1, "the same session continued");
  });

  it("waits for the network while offline without using up retries", async () => {
    const h = harness();
    h.server.faults.push(() => "pass");
    h.server.faults.push(() => {
      h.online.value = false;
      throw new NetworkError();
    });
    const { task, snapshots } = makeTask(h, videoFile());
    task.start();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done");
    assert.equal(h.online.waits, 1);
    assert.equal(h.sleeps.length, 0);
    assert.ok(snapshots.some((s) => s.offline));
  });

  it("pauses and resumes from the server offset", async () => {
    const h = harness();
    const file = videoFile();
    let release: (() => void) | null = null;
    const hold: Fault = (req) => {
      if (req.method !== "PATCH") {
        h.server.faults.unshift(hold);
        return "pass";
      }
      // Hang the first chunk until the signal aborts it.
      return new Promise<HttpResult>((_, reject) => {
        release = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        req.signal.addEventListener("abort", () => release?.(), { once: true });
      });
    };
    h.server.faults.push(hold);
    const { task } = makeTask(h, file);
    task.start();
    await new Promise<void>((resolve) => {
      const check = () => (release ? resolve() : setTimeout(check, 1));
      check();
    });
    task.pause();
    assert.equal(task.snapshot.phase, "paused");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(task.snapshot.phase, "paused", "an aborted request does not turn into an error");

    task.resume();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done");
    const log = h.server.log.join("\n");
    assert.match(log, /PATCH[^\n]*\nHEAD/, "resume asks for the offset first");
  });

  it("resumes even when Resume is pressed before the paused request has unwound", async () => {
    const h = harness();
    const hold: Fault = (req) => {
      if (req.method !== "PATCH") {
        h.server.faults.unshift(hold);
        return "pass";
      }
      return new Promise<HttpResult>((_, reject) => req.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
    };
    h.server.faults.push(hold);
    const { task } = makeTask(h, videoFile());
    task.start();
    await new Promise<void>((resolve) => {
      const check = () => (h.server.log.some((l) => l.startsWith("PATCH")) ? resolve() : setTimeout(check, 1));
      check();
    });
    h.server.faults.length = 0;
    // Pause and resume in the same tick: the first run has not finished unwinding yet.
    task.pause();
    task.resume();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done");
  });

  it("continues an upload started before a reload when the same file is chosen", async () => {
    const h = harness();
    const file = videoFile();
    // First page: two chunks, then the tab closes (pause keeps the session).
    let patches = 0;
    const stopAfterTwo: Fault = (req) => {
      h.server.faults.unshift(stopAfterTwo);
      if (req.method === "PATCH" && ++patches === 3) return new Promise<HttpResult>(() => undefined);
      return "pass";
    };
    h.server.faults.push(stopAfterTwo);
    const first = makeTask(h, file);
    first.task.start();
    await new Promise<void>((resolve) => {
      const check = () => (patches >= 3 ? resolve() : setTimeout(check, 1));
      check();
    });
    first.task.pause();
    h.server.faults.length = 0;
    const record = h.storage.getItem(resumeKeyFor(file, "video"));
    assert.ok(record, "resume record written");

    // Second page, same browser storage: no new session is created.
    const posts = h.server.log.filter((l) => l === "POST /api/uploads").length;
    const second = makeTask(h, file);
    second.task.start();
    const final = await runUntil(second.task, ["done", "error"]);
    assert.equal(final.phase, "done");
    assert.equal(final.resumed, true);
    assert.equal(h.server.log.filter((l) => l === "POST /api/uploads").length, posts);
    assert.equal(h.server.log.filter((l) => l.startsWith("PATCH")).length, 4, "only the missing chunk was sent again");
    const id = [...h.server.sessions.keys()][0]!;
    assert.deepEqual(h.server.bytesOf(id), await fileBytes(file));
  });

  it("starts over when the remembered session expired", async () => {
    const h = harness();
    const file = videoFile();
    h.storage.setItem(
      resumeKeyFor(file, "video"),
      JSON.stringify({ id: "ups_gone00000001", fileName: file.name, size: file.size, offset: 100, savedAt: 1_700_000_000_000, scope: "video:videoUrl" }),
    );
    const { task } = makeTask(h, file);
    task.start();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done");
    assert.equal(final.resumed, false);
    assert.ok(h.server.log.includes("HEAD /api/uploads/ups_gone00000001"));
  });

  it("cancel deletes the session and the resume record", async () => {
    const h = harness();
    const file = videoFile();
    const hang: Fault = (req) => {
      if (req.method === "PATCH") return new Promise<HttpResult>((_, reject) => req.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      h.server.faults.unshift(hang);
      return "pass";
    };
    h.server.faults.push(hang);
    const { task } = makeTask(h, file);
    task.start();
    await new Promise<void>((resolve) => {
      const check = () => (h.server.log.some((l) => l.startsWith("PATCH")) ? resolve() : setTimeout(check, 1));
      check();
    });
    h.server.faults.length = 0;
    task.cancel();
    assert.equal(task.snapshot.phase, "cancelled");
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(h.server.log.some((l) => l.startsWith("DELETE /api/uploads/ups_fake")));
    assert.equal([...h.server.sessions.values()][0]!.status, "aborted");
    assert.equal(h.storage.length, 0);
  });
});

describe("UploadTask (single request)", () => {
  it("sends small documents in one request to /api/upload", async () => {
    const h = harness();
    const file = new File([new Uint8Array(5000)], "notes.pdf", { type: "application/pdf", lastModified: 1 });
    const { task, completed } = makeTask(h, file, { kind: "document", scope: "document:" });
    assert.equal(task.chunked, false);
    task.start();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done");
    assert.equal(h.server.simpleUploads, 1);
    assert.equal(completed[0]!.url, "/uploads/notes.pdf");
    assert.equal(h.server.sessions.size, 0);
  });

  it("retries a failed single request", async () => {
    const h = harness();
    h.server.faults.push(() => {
      throw new NetworkError();
    });
    const file = new File([new Uint8Array(10)], "a.png", { type: "image/png", lastModified: 1 });
    const { task } = makeTask(h, file, { kind: "auto" });
    task.start();
    const final = await runUntil(task, ["done", "error"]);
    assert.equal(final.phase, "done");
    assert.equal(h.sleeps.length, 1);
  });
});

describe("pending uploads", () => {
  it("lists and discards remembered uploads for one uploader", async () => {
    const h = harness();
    const now = 1_700_000_000_000;
    const put = (key: string, id: string, scope: string, savedAt = now - 1000) =>
      h.storage.setItem(key, JSON.stringify({ id, fileName: "a.mp4", size: 100, offset: 50, savedAt, scope }));
    h.server.sessions.set("ups_pending00001", { size: 100, data: [], received: 50, status: "uploading" });
    put("ll-upload:video:100:1:a.mp4", "ups_pending00001", "video:videoUrl");
    put("ll-upload:video:100:2:b.mp4", "ups_pending00002", "video:other");
    put("ll-upload:video:100:3:c.mp4", "ups_pending00003", "video:videoUrl", now - 2 * 24 * 60 * 60 * 1000);
    h.storage.setItem("ll-upload:video:100:4:d.mp4", "{broken");
    h.storage.setItem("unrelated", "1");

    const pending = listPendingUploads("video", "video:videoUrl", h.storage, now);
    assert.deepEqual(
      pending.map((p) => p.id),
      ["ups_pending00001"],
    );
    // Expired and malformed records were removed.
    assert.equal(h.storage.getItem("ll-upload:video:100:3:c.mp4"), null);
    assert.equal(h.storage.getItem("ll-upload:video:100:4:d.mp4"), null);
    assert.equal(h.storage.getItem("unrelated"), "1");

    await discardPendingUpload(pending[0]!, h.env);
    assert.equal(h.storage.getItem("ll-upload:video:100:1:a.mp4"), null);
    assert.equal(h.server.sessions.get("ups_pending00001")!.status, "aborted");
  });
});

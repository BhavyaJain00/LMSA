import {
  MAX_CHUNK_RETRIES,
  RESUME_KEY_PREFIX,
  UPLOAD_LENGTH_HEADER,
  UPLOAD_OFFSET_HEADER,
  effectiveChunkSize,
  estimateRemaining,
  isFatalUploadStatus,
  nextChunkRange,
  parseOffsetHeader,
  parseResumeRecord,
  resumeKeyFor,
  retryDelayMs,
  shouldUseResumable,
  smoothSpeed,
  type ResumeRecord,
} from "./resumable-shared";

/**
 * Browser side of the upload protocols (see `resumable-shared.ts`).
 *
 * `UploadTask` sends one file: small images and documents in a single
 * multipart request to `/api/upload`, videos and anything larger than a chunk
 * through the resumable `/api/uploads` protocol — chunk by chunk, with
 * per-chunk progress, pause/resume, retries with exponential backoff (a
 * dropped connection or a server hiccup never loses what already arrived),
 * waiting for the network to come back, and a localStorage record so that
 * choosing the same file again after a reload continues where it stopped.
 *
 * Transport, storage and timers are injectable so the logic can be tested
 * without a browser.
 */

export interface UploadedFile {
  url: string;
  name: string;
  size: number;
  type: string;
}

export type UploadPhase =
  /** Creating the session (or finding the one to resume). */
  | "starting"
  | "uploading"
  /** Stopped by the user; `resume()` continues. */
  | "paused"
  /** A request failed; retrying after a delay (or once the network is back). */
  | "retrying"
  /** All bytes sent; the server is checking and storing the file. */
  | "finishing"
  | "done"
  /** Stopped with an error; `resume()` tries again when `canResume`. */
  | "error"
  | "cancelled";

export interface UploadSnapshot {
  phase: UploadPhase;
  fileName: string;
  total: number;
  /** Bytes the server has (plus the part of the current chunk already sent). */
  loaded: number;
  bytesPerSecond: number;
  secondsLeft: number | null;
  /** Failed attempts in a row (while retrying). */
  attempt: number;
  error: string | null;
  /** Whether `resume()` can continue after a pause or an error. */
  canResume: boolean;
  /** True when this upload continued one started earlier (e.g. before a reload). */
  resumed: boolean;
  offline: boolean;
  /** True for the chunked protocol, false for the single-request upload. */
  chunked: boolean;
}

/* ------------------------------------------------------------------ */
/* Environment                                                          */
/* ------------------------------------------------------------------ */

export interface HttpResult {
  status: number;
  header(name: string): string | null;
  body: Record<string, unknown> | null;
}

export interface HttpRequest {
  method: "GET" | "HEAD" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: Blob | FormData | string | null;
  headers?: Record<string, string>;
  signal: AbortSignal;
  /** Bytes of the request body sent so far. */
  onUploadProgress?: (loaded: number) => void;
}

/** Sends a request; rejects with a `NetworkError` when no response arrived and with an `AbortError` when aborted. */
export type Transport = (request: HttpRequest) => Promise<HttpResult>;

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export interface UploadEnvironment {
  transport: Transport;
  /** Where resume records live (null disables resuming after a reload). */
  storage: KeyValueStorage | null;
  /** Resolves after `ms`, or rejects with an AbortError when the signal aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  isOnline: () => boolean;
  /** Resolves when the network is back (or rejects when the signal aborts). */
  waitForOnline: (signal: AbortSignal) => Promise<void>;
  now: () => number;
}

export class NetworkError extends Error {
  constructor(message = "The connection was interrupted.") {
    super(message);
    this.name = "NetworkError";
  }
}

function abortError(): Error {
  const err = new Error("The upload was stopped.");
  err.name = "AbortError";
  return err;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** `XMLHttpRequest` transport: unlike `fetch`, it reports upload progress. */
export const xhrTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    if (req.signal.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(req.method, req.url);
    for (const [name, value] of Object.entries(req.headers ?? {})) xhr.setRequestHeader(name, value);
    if (req.onUploadProgress) {
      const report = req.onUploadProgress;
      xhr.upload.onprogress = (e) => report(e.loaded);
    }
    const onAbort = () => xhr.abort();
    req.signal.addEventListener("abort", onAbort, { once: true });
    const done = () => req.signal.removeEventListener("abort", onAbort);
    xhr.onload = () => {
      done();
      let body: Record<string, unknown> | null = null;
      if (xhr.responseText) {
        try {
          const parsed: unknown = JSON.parse(xhr.responseText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
        } catch {
          body = null;
        }
      }
      resolve({ status: xhr.status, header: (name) => xhr.getResponseHeader(name), body });
    };
    xhr.onerror = () => {
      done();
      reject(new NetworkError());
    };
    xhr.ontimeout = () => {
      done();
      reject(new NetworkError("The server took too long to answer."));
    };
    xhr.onabort = () => {
      done();
      reject(abortError());
    };
    xhr.send(req.body ?? null);
  });

function browserStorage(): KeyValueStorage | null {
  try {
    const s = window.localStorage;
    const probe = `${RESUME_KEY_PREFIX}probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      window.removeEventListener("online", finish);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      window.removeEventListener("online", finish);
      reject(abortError());
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    // Coming back online ends the wait early.
    window.addEventListener("online", finish, { once: true });
  });

const waitForOnline = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onOnline = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      window.removeEventListener("online", onOnline);
      reject(abortError());
    };
    window.addEventListener("online", onOnline, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** The real browser environment. */
export function browserUploadEnvironment(): UploadEnvironment {
  return {
    transport: xhrTransport,
    storage: browserStorage(),
    sleep,
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    waitForOnline,
    now: () => Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Resume records                                                       */
/* ------------------------------------------------------------------ */

const recordListeners = new Set<() => void>();
let recordVersion = 0;

function recordsChanged(): void {
  recordVersion++;
  for (const listener of recordListeners) listener();
}

/** Subscribe to changes of the remembered uploads (this tab and, via `storage` events, other tabs). For `useSyncExternalStore`. */
export function subscribePendingUploads(listener: () => void): () => void {
  recordListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(RESUME_KEY_PREFIX)) {
      recordVersion++;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    recordListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Changes whenever a remembered upload is written or removed. For `useSyncExternalStore`. */
export function pendingUploadsVersion(): number {
  return recordVersion;
}

function readRecord(storage: KeyValueStorage | null, key: string, now: number): ResumeRecord | null {
  if (!storage) return null;
  try {
    const record = parseResumeRecord(storage.getItem(key), now);
    if (!record) storage.removeItem(key);
    return record;
  } catch {
    return null;
  }
}

function writeRecord(storage: KeyValueStorage | null, key: string, record: ResumeRecord): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(record));
    recordsChanged();
  } catch {
    // Storage full or blocked: the upload still works, it just cannot resume after a reload.
  }
}

function removeRecord(storage: KeyValueStorage | null, key: string): void {
  if (!storage) return;
  try {
    const existed = storage.getItem(key) !== null;
    storage.removeItem(key);
    if (existed) recordsChanged();
  } catch {
    // Ignore: nothing to clean up without storage.
  }
}

export interface PendingUpload extends ResumeRecord {
  key: string;
}

/**
 * Unfinished uploads remembered in this browser for an uploader (`kind` and
 * `scope`), newest first. Expired or malformed records are removed.
 */
export function listPendingUploads(kind: string, scope: string, storage: KeyValueStorage | null = browserStorage(), now = Date.now()): PendingUpload[] {
  if (!storage) return [];
  const prefix = `${RESUME_KEY_PREFIX}${kind}:`;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return [];
  }
  const out: PendingUpload[] = [];
  for (const key of keys) {
    const record = readRecord(storage, key, now);
    if (record && record.scope === scope) out.push({ ...record, key });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** Forget an unfinished upload and cancel it on the server (best effort). */
export async function discardPendingUpload(pending: PendingUpload, env: Pick<UploadEnvironment, "transport" | "storage"> = browserUploadEnvironment()): Promise<void> {
  removeRecord(env.storage, pending.key);
  try {
    await env.transport({ method: "DELETE", url: `/api/uploads/${encodeURIComponent(pending.id)}`, signal: new AbortController().signal });
  } catch {
    // Already gone, or offline: the server expires it after a day anyway.
  }
}

/* ------------------------------------------------------------------ */
/* The task                                                             */
/* ------------------------------------------------------------------ */

/** A failure retrying cannot fix (bad file, not allowed, session gone …). */
class FatalUploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FatalUploadError";
    this.status = status;
  }
}

/** A failure worth retrying (network, 5xx, busy, rate limited). */
class TransientUploadError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "TransientUploadError";
    this.retryAfterMs = retryAfterMs;
  }
}

function messageOf(res: HttpResult, fallback: string): string {
  const error = res.body?.error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

function retryAfterOf(res: HttpResult): number | null {
  const raw = res.header("Retry-After");
  if (!raw || !/^\d{1,6}$/.test(raw.trim())) return null;
  return Number(raw.trim()) * 1000;
}

/** Turn a non-success response into the error to throw. */
function failureOf(res: HttpResult, fallback: string): Error {
  const message = messageOf(res, fallback);
  if (res.status === 429) {
    const retryAfter = retryAfterOf(res);
    // Without Retry-After it is the unfinished-uploads limit: waiting will not help.
    return retryAfter === null ? new FatalUploadError(message, 429) : new TransientUploadError(message, retryAfter);
  }
  if (isFatalUploadStatus(res.status)) return new FatalUploadError(message, res.status);
  return new TransientUploadError(message);
}

const SESSION_GONE = "This upload expired or was cancelled on the server. Start it again.";
/** Minimum time between progress notifications. */
const EMIT_INTERVAL_MS = 120;
/** Minimum window for a speed sample. */
const SPEED_WINDOW_MS = 400;

export interface UploadTaskOptions {
  file: File;
  kind: "video" | "image" | "document" | "auto";
  /** Identifies the uploader (see `listPendingUploads`). */
  scope?: string;
  onUpdate?: (snapshot: UploadSnapshot) => void;
  onComplete?: (file: UploadedFile) => void;
  env?: UploadEnvironment;
}

export class UploadTask {
  readonly file: File;
  readonly kind: UploadTaskOptions["kind"];
  readonly chunked: boolean;
  private readonly scope: string;
  private readonly env: UploadEnvironment;
  private readonly onUpdate?: (snapshot: UploadSnapshot) => void;
  private readonly onComplete?: (file: UploadedFile) => void;
  private readonly resumeKey: string;

  private sessionId: string | null = null;
  private offset = 0;
  private chunkSize = effectiveChunkSize(undefined);
  private needsSync = false;
  private controller: AbortController | null = null;
  private running = false;
  private snap: UploadSnapshot;
  private lastEmit = 0;
  private speedMark: { at: number; loaded: number } | null = null;

  constructor(options: UploadTaskOptions) {
    this.file = options.file;
    this.kind = options.kind;
    this.scope = options.scope ?? "";
    this.env = options.env ?? browserUploadEnvironment();
    this.onUpdate = options.onUpdate;
    this.onComplete = options.onComplete;
    this.chunked = shouldUseResumable(options.file);
    this.resumeKey = resumeKeyFor(options.file, options.kind);
    this.snap = {
      phase: "starting",
      fileName: options.file.name,
      total: options.file.size,
      loaded: 0,
      bytesPerSecond: 0,
      secondsLeft: null,
      attempt: 0,
      error: null,
      canResume: false,
      resumed: false,
      offline: false,
      chunked: this.chunked,
    };
  }

  get snapshot(): UploadSnapshot {
    return this.snap;
  }

  /** Start (or continue) sending. Safe to call again after `pause()` or an error. */
  start(): void {
    if (this.running || this.snap.phase === "done" || this.snap.phase === "cancelled") return;
    void this.run();
  }

  /** Stop sending; what the server already has is kept. */
  pause(): void {
    if (!this.running || this.snap.phase === "finishing") return;
    this.controller?.abort();
    this.update({ phase: "paused", canResume: true, bytesPerSecond: 0, secondsLeft: null, offline: false }, true);
  }

  resume(): void {
    if (this.snap.phase !== "paused" && !(this.snap.phase === "error" && this.snap.canResume)) return;
    this.needsSync = this.sessionId !== null;
    this.start();
  }

  /** Stop and delete what was uploaded so far. */
  cancel(): void {
    if (this.snap.phase === "done" || this.snap.phase === "cancelled") return;
    this.controller?.abort();
    removeRecord(this.env.storage, this.resumeKey);
    const id = this.sessionId;
    this.sessionId = null;
    this.update({ phase: "cancelled", canResume: false, bytesPerSecond: 0, secondsLeft: null }, true);
    if (id) {
      this.env.transport({ method: "DELETE", url: this.sessionUrl(id), signal: new AbortController().signal }).catch(() => undefined);
    }
  }

  /* ---------------------------------------------------------------- */

  private sessionUrl(id: string): string {
    return `/api/uploads/${encodeURIComponent(id)}`;
  }

  private update(patch: Partial<UploadSnapshot>, force = false): void {
    this.snap = { ...this.snap, ...patch };
    const now = this.env.now();
    if (!force && now - this.lastEmit < EMIT_INTERVAL_MS) return;
    this.lastEmit = now;
    this.onUpdate?.(this.snap);
  }

  private reportProgress(loaded: number): void {
    const now = this.env.now();
    let speed = this.snap.bytesPerSecond;
    if (!this.speedMark) this.speedMark = { at: now, loaded };
    else if (now - this.speedMark.at >= SPEED_WINDOW_MS) {
      speed = smoothSpeed(speed, Math.max(0, loaded - this.speedMark.loaded), now - this.speedMark.at);
      this.speedMark = { at: now, loaded };
    }
    this.update({ loaded: Math.min(loaded, this.file.size), bytesPerSecond: speed, secondsLeft: estimateRemaining(this.file.size - loaded, speed) });
  }

  private saveRecord(): void {
    if (!this.sessionId) return;
    writeRecord(this.env.storage, this.resumeKey, {
      id: this.sessionId,
      fileName: this.file.name,
      size: this.file.size,
      offset: this.offset,
      savedAt: this.env.now(),
      scope: this.scope,
    });
  }

  private async run(): Promise<void> {
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    this.speedMark = null;
    this.update({ phase: this.chunked && this.sessionId ? "uploading" : "starting", error: null, attempt: 0, canResume: false, offline: false }, true);
    // Failed attempts in a row; reset only once bytes move again, so a
    // server that keeps refusing chunks cannot keep the loop going forever.
    let attempt = 0;
    let recovering = false;
    let failedAt = 0;
    try {
      for (;;) {
        try {
          const result = this.chunked ? await this.step(signal) : await this.sendWhole(signal);
          if (result) {
            removeRecord(this.env.storage, this.resumeKey);
            this.update({ phase: "done", loaded: this.file.size, secondsLeft: 0, canResume: false, error: null, attempt: 0 }, true);
            this.onComplete?.(result);
            return;
          }
          if (recovering) {
            recovering = false;
            this.update({ phase: this.snap.phase === "finishing" ? "finishing" : "uploading", error: null, offline: false }, true);
          }
          if (attempt && this.offset > failedAt) {
            attempt = 0;
            this.update({ attempt: 0 });
          }
        } catch (err) {
          if (isAbortError(err) || signal.aborted) return;
          if (err instanceof FatalUploadError) throw err;
          recovering = true;
          failedAt = this.offset;
          if (!this.env.isOnline()) {
            // Offline: wait for the network without using up retries.
            this.update({ phase: "retrying", offline: true, bytesPerSecond: 0, secondsLeft: null, error: "You are offline. The upload continues when the connection is back." }, true);
            await this.env.waitForOnline(signal);
            this.needsSync = this.sessionId !== null;
            continue;
          }
          attempt++;
          if (attempt > MAX_CHUNK_RETRIES) {
            throw new FatalUploadError(`${err instanceof Error ? err.message : "The upload failed."} Resume to try again.`, 0);
          }
          const delay = err instanceof TransientUploadError && err.retryAfterMs !== null ? err.retryAfterMs : retryDelayMs(attempt);
          this.update({ phase: "retrying", attempt, offline: false, bytesPerSecond: 0, secondsLeft: null, error: err instanceof Error ? err.message : "The upload failed." }, true);
          await this.env.sleep(delay, signal);
          this.needsSync = this.sessionId !== null;
          this.speedMark = null;
        }
      }
    } catch (err) {
      if (isAbortError(err) || signal.aborted) return;
      const fatal = err instanceof FatalUploadError ? err : new FatalUploadError(err instanceof Error ? err.message : "The upload failed.", 0);
      // Retries used up: the session is intact and continues. An expired session starts over. A refused file cannot be retried.
      const canResume = fatal.status === 0 || fatal.status === 404 || fatal.status === 410;
      this.update({ phase: "error", error: fatal.message, canResume, bytesPerSecond: 0, secondsLeft: null, offline: false }, true);
    } finally {
      if (this.controller === controller) this.controller = null;
      this.running = false;
    }
  }

  /** One step of the chunked protocol; returns the result once the file is complete. */
  private async step(signal: AbortSignal): Promise<UploadedFile | null> {
    if (!this.sessionId) {
      await this.openSession(signal);
      return null;
    }
    if (this.needsSync) {
      await this.syncOffset(signal);
      this.needsSync = false;
      return null;
    }
    if (this.offset < this.file.size) {
      await this.sendChunk(signal);
      return null;
    }
    return this.complete(signal);
  }

  /** Continue a remembered session for this file, or start a new one. */
  private async openSession(signal: AbortSignal): Promise<void> {
    const record = readRecord(this.env.storage, this.resumeKey, this.env.now());
    if (record && record.size === this.file.size) {
      const res = await this.env.transport({ method: "HEAD", url: this.sessionUrl(record.id), signal });
      const offset = parseOffsetHeader(res.header(UPLOAD_OFFSET_HEADER));
      const length = parseOffsetHeader(res.header(UPLOAD_LENGTH_HEADER));
      if (res.status === 200 && offset !== null && length === this.file.size) {
        // A session that already completed (e.g. a reload while finishing) just returns its URL again.
        this.sessionId = record.id;
        this.offset = res.header("Upload-Status") === "complete" ? this.file.size : Math.min(offset, this.file.size);
        this.saveRecord();
        this.update({ phase: "uploading", loaded: this.offset, resumed: true }, true);
        return;
      }
      if (res.status >= 500 || res.status === 429) throw failureOf(res, "The server is busy.");
      removeRecord(this.env.storage, this.resumeKey);
    }

    const res = await this.env.transport({
      method: "POST",
      url: "/api/uploads",
      body: JSON.stringify({ kind: this.kind, fileName: this.file.name, size: this.file.size, mimeType: this.file.type }),
      headers: { "Content-Type": "application/json" },
      signal,
    });
    const id = res.body?.id;
    if (res.status !== 201 || typeof id !== "string") throw failureOf(res, "The upload could not be started.");
    this.sessionId = id;
    this.offset = 0;
    this.chunkSize = effectiveChunkSize(res.body?.chunkSize);
    this.saveRecord();
    this.update({ phase: "uploading", loaded: 0 }, true);
  }

  /** Ask the server how many bytes it has (after a pause, a failure or a reload). */
  private async syncOffset(signal: AbortSignal): Promise<void> {
    const id = this.sessionId!;
    const res = await this.env.transport({ method: "HEAD", url: this.sessionUrl(id), signal });
    if (res.status === 404 || res.status === 410) {
      removeRecord(this.env.storage, this.resumeKey);
      this.sessionId = null;
      this.offset = 0;
      throw new FatalUploadError(SESSION_GONE, res.status);
    }
    if (res.status !== 200) throw failureOf(res, "Could not check how much of the file arrived.");
    const offset = parseOffsetHeader(res.header(UPLOAD_OFFSET_HEADER));
    if (offset === null) throw new TransientUploadError("Could not check how much of the file arrived.");
    this.offset = Math.min(offset, this.file.size);
    this.saveRecord();
    this.update({ phase: "uploading", loaded: this.offset }, true);
  }

  private async sendChunk(signal: AbortSignal): Promise<void> {
    const id = this.sessionId!;
    const range = nextChunkRange(this.offset, this.file.size, this.chunkSize)!;
    const start = range.start;
    const res = await this.env.transport({
      method: "PATCH",
      url: this.sessionUrl(id),
      body: this.file.slice(range.start, range.end),
      headers: { [UPLOAD_OFFSET_HEADER]: String(start), "Content-Type": "application/offset+octet-stream" },
      signal,
      onUploadProgress: (sent) => this.reportProgress(start + sent),
    });
    const serverOffset = parseOffsetHeader(res.header(UPLOAD_OFFSET_HEADER));
    if (res.status === 200 && serverOffset !== null && serverOffset > start) {
      // A chunk cut short on the way still counts: the next one starts where the server stopped.
      this.offset = Math.min(serverOffset, this.file.size);
      this.saveRecord();
      this.reportProgress(this.offset);
      return;
    }
    if (res.status === 200) throw new TransientUploadError("The chunk did not arrive.");
    if (res.status === 409 && serverOffset !== null && serverOffset !== start) {
      // The server has a different amount than we thought: continue from its offset.
      this.offset = Math.min(serverOffset, this.file.size);
      this.saveRecord();
      this.update({ loaded: this.offset }, true);
      return;
    }
    if (res.status === 404 || res.status === 410) {
      removeRecord(this.env.storage, this.resumeKey);
      this.sessionId = null;
      this.offset = 0;
      throw new FatalUploadError(messageOf(res, SESSION_GONE), res.status);
    }
    throw failureOf(res, "A chunk could not be stored.");
  }

  private async complete(signal: AbortSignal): Promise<UploadedFile | null> {
    const id = this.sessionId!;
    this.update({ phase: "finishing", loaded: this.file.size, secondsLeft: null }, true);
    const res = await this.env.transport({ method: "POST", url: `${this.sessionUrl(id)}/complete`, signal });
    const url = res.body?.url;
    if (res.status === 200 && typeof url === "string") return this.resultOf(res, url);
    const serverOffset = parseOffsetHeader(res.header(UPLOAD_OFFSET_HEADER));
    if (res.status === 409 && serverOffset !== null && serverOffset < this.file.size) {
      this.offset = serverOffset;
      this.update({ phase: "uploading", loaded: serverOffset }, true);
      return null;
    }
    if (res.status === 404 || res.status === 410 || res.status === 415) {
      removeRecord(this.env.storage, this.resumeKey);
      this.sessionId = null;
      this.offset = 0;
    }
    throw failureOf(res, "The upload could not be finished.");
  }

  /** Small files: one multipart request to `/api/upload` (retried whole on failure). */
  private async sendWhole(signal: AbortSignal): Promise<UploadedFile | null> {
    this.update({ phase: "uploading" }, true);
    const form = new FormData();
    form.append("file", this.file);
    form.append("kind", this.kind);
    const res = await this.env.transport({
      method: "POST",
      url: "/api/upload",
      body: form,
      signal,
      // The multipart body is slightly larger than the file; cap at the file size.
      onUploadProgress: (sent) => this.reportProgress(Math.min(sent, this.file.size)),
    });
    const url = res.body?.url;
    if (res.status === 200 && res.body?.ok === true && typeof url === "string") return this.resultOf(res, url);
    throw failureOf(res, "Upload failed.");
  }

  private resultOf(res: HttpResult, url: string): UploadedFile {
    const b = res.body ?? {};
    return {
      url,
      name: typeof b.name === "string" ? b.name : this.file.name,
      size: typeof b.size === "number" ? b.size : this.file.size,
      type: typeof b.type === "string" ? b.type : this.file.type,
    };
  }
}

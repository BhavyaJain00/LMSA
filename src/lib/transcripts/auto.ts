import "server-only";
import fs from "node:fs/promises";
import { openAsBlob } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, getSettings, mutate } from "@/lib/db/store";
import { transcribeEnv } from "@/lib/server-env";
import { detectFfmpeg, FfmpegError, probeMedia, runFfmpeg } from "@/lib/media/transcode/ffmpeg";
import { storageFor, storageKeyFromUrl } from "@/lib/storage";
import { siteOrigins } from "@/lib/media/access";
import { stripMediaToken } from "@/lib/media/paths";
import { notifyMany } from "@/lib/services/notifications";
import { uid } from "@/lib/utils";
import { mergePartSegments, segmentsToCues, type TimedSegment } from "./cues";
import { blockTranscript, findVideoBlock, patchBlockTranscript, upsertBlockTranscript } from "./data";
import {
  AUDIO_PART_SECONDS,
  MAX_AUDIO_PART_BYTES,
  apiErrorMessage,
  audioExtractArgs,
  continuityPrompt,
  isMissingEncoderError,
  isPublicMediaUrl,
  isRefusedInputError,
  languageHint,
  parseTranscriptionResponse,
  retryAfterMs,
  sortAudioParts,
  transcriptionEndpoint,
  type AudioCodec,
} from "./stt";
import { SourceDownloadError, downloadPublicMedia } from "./source-download";

/**
 * Automatic transcripts for lesson videos.
 *
 * `requestAutoTranscript(lessonId, blockId)` queues a job (one runs at a
 * time, in process). The job extracts the audio track with ffmpeg as 16 kHz
 * mono parts of at most 10 minutes (each well under the 25 MB request
 * limit), posts every part to an OpenAI-compatible
 * `/v1/audio/transcriptions` endpoint with `response_format=verbose_json`,
 * shifts each part's timings by where it starts, turns the segments into
 * caption-sized cues and stores them as the block's transcript.
 *
 * Automatic requests (after an upload is converted) run only when Settings →
 * Storage & video → "Generate captions automatically" is on, and never
 * replace a transcript someone uploaded or edited. The editor's "Generate
 * transcript" button (`manual`) works whenever the API and ffmpeg are set up.
 */

export interface TranscriptionAvailability {
  /** The editor button can be used. */
  available: boolean;
  apiConfigured: boolean;
  ffmpegAvailable: boolean;
  /** Settings → automatic captions for new uploads. */
  autoEnabled: boolean;
  model: string;
  /** Why generation is unavailable (null when it is). */
  reason: string | null;
}

export type TranscriptionStage = "queued" | "extracting" | "transcribing" | "saving";

export interface TranscriptionJobState {
  stage: TranscriptionStage;
  /** Audio parts sent so far / total (while transcribing). */
  part?: number;
  parts?: number;
  queuedAt: string;
  startedAt?: string;
}

interface Job {
  id: string;
  lessonId: string;
  blockId: string;
  manual: boolean;
  language: string | null;
  requestedBy: string | null;
  queuedAt: string;
}

interface Worker {
  queue: Job[];
  current: { job: Job; state: TranscriptionJobState; abort: AbortController } | null;
  running: boolean;
  recovered: boolean;
}

const g = globalThis as unknown as { __llTranscribeWorker?: Worker };
const worker: Worker = (g.__llTranscribeWorker ??= { queue: [], current: null, running: false, recovered: false });

const REQUEST_TIMEOUT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 4;
const EXTRACT_STALL_MS = 120_000;
const MAX_QUEUE = 200;
/** A source URL presigned for ffmpeg stays valid this long. */
const SOURCE_URL_TTL_SECONDS = 6 * 3600;

const key = (lessonId: string, blockId: string) => `${lessonId}:${blockId}`;
const nowIso = () => new Date().toISOString();

class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

const CANCELLED_MESSAGE = "Generation was cancelled.";

class TranscriptionCancelled extends Error {
  constructor(message = CANCELLED_MESSAGE) {
    super(message);
    this.name = "TranscriptionCancelled";
  }
}

/* ------------------------------------------------------------------ */
/* Availability and state                                               */
/* ------------------------------------------------------------------ */

export async function transcriptionAvailability(): Promise<TranscriptionAvailability> {
  const [settings, ffmpeg] = await Promise.all([getSettings(), detectFfmpeg()]);
  const endpoint = transcriptionEndpoint(transcribeEnv.apiUrl);
  const apiConfigured = !!endpoint && !!transcribeEnv.apiKey;
  let reason: string | null = null;
  if (!apiConfigured) {
    reason = transcribeEnv.apiUrl && !endpoint
      ? "TRANSCRIBE_API_URL is not a valid http(s) URL."
      : "Add TRANSCRIBE_API_URL and TRANSCRIBE_API_KEY to the server's .env file (any OpenAI-compatible speech-to-text endpoint), then restart the app.";
  } else if (!ffmpeg.available) {
    reason = `ffmpeg is needed to extract the audio: ${ffmpeg.error ?? "it was not found"}. Install it (\`winget install Gyan.FFmpeg\` on Windows, \`apt install ffmpeg\` on Linux) or set FFMPEG_PATH.`;
  }
  return {
    available: !reason,
    apiConfigured,
    ffmpegAvailable: ffmpeg.available,
    autoEnabled: settings.storage.autoTranscribe,
    model: transcribeEnv.model,
    reason,
  };
}

/** The queued or running job of a block, or null. */
export function transcriptionJobState(lessonId: string, blockId: string): TranscriptionJobState | null {
  const k = key(lessonId, blockId);
  if (worker.current && key(worker.current.job.lessonId, worker.current.job.blockId) === k) return { ...worker.current.state };
  const queued = worker.queue.find((j) => key(j.lessonId, j.blockId) === k);
  return queued ? { stage: "queued", queuedAt: queued.queuedAt } : null;
}

/**
 * Transcripts left "processing" by a server restart have no job anymore:
 * mark them failed so the editor offers to try again. Runs once per process.
 */
export async function recoverInterruptedTranscripts(): Promise<void> {
  if (worker.recovered) return;
  worker.recovered = true;
  await mutate((db) => {
    for (const t of db.transcripts) {
      if (t.status !== "processing" || transcriptionJobState(t.lessonId, t.blockId)) continue;
      t.status = t.cues.length ? "ready" : "failed";
      t.error = "Generation was interrupted by a server restart. Generate the transcript again.";
      t.updatedAt = nowIso();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Requests                                                             */
/* ------------------------------------------------------------------ */

export interface AutoTranscriptOptions {
  /** Started from the editor: runs even when automatic captions are off, and may replace edited transcripts. */
  manual?: boolean;
  /** BCP 47 language hint; the service detects the language when omitted. */
  language?: string | null;
  /** User who asked (notified when done). */
  requestedBy?: string | null;
}

export type AutoTranscriptResult = { queued: true; state: TranscriptionJobState } | { queued: false; reason: string };

/**
 * Queue automatic transcription of a lesson video block. Safe to call from
 * the transcoding pipeline's `onVideoReady` hook: it returns without doing
 * anything when automatic captions are off or a human-made transcript exists.
 */
export async function requestAutoTranscript(lessonId: string, blockId: string, opts: AutoTranscriptOptions = {}): Promise<AutoTranscriptResult> {
  await recoverInterruptedTranscripts();
  const manual = !!opts.manual;
  const availability = await transcriptionAvailability();
  if (!manual && !availability.autoEnabled) return { queued: false, reason: "Automatic captions are turned off in Settings → Storage & video." };
  if (!availability.available) return { queued: false, reason: availability.reason ?? "Transcription is not available." };

  const existing = transcriptionJobState(lessonId, blockId);
  if (existing) return { queued: true, state: existing };
  if (worker.queue.length >= MAX_QUEUE) return { queued: false, reason: "Too many transcripts are waiting. Try again in a few minutes." };

  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId);
  const block = findVideoBlock(lesson, blockId);
  if (!lesson || !block) return { queued: false, reason: "This video no longer exists." };
  if (!block.src) return { queued: false, reason: "Add a video file before generating a transcript." };
  const current = blockTranscript(db, block);
  if (!manual && current && current.cues.length && current.source !== "auto") {
    return { queued: false, reason: "This video already has an uploaded or edited transcript." };
  }

  const language = opts.language ?? current?.language ?? null;
  const job: Job = {
    id: uid("stt"),
    lessonId,
    blockId,
    manual,
    language,
    requestedBy: opts.requestedBy ?? null,
    queuedAt: nowIso(),
  };

  await mutate((d) => {
    const t = blockTranscript(d, findVideoBlock(d.lessons.find((l) => l.id === lessonId), blockId));
    if (t && t.cues.length) {
      // Keep the current cues visible until the new ones are ready.
      patchBlockTranscript(d, lessonId, blockId, () => ({ error: undefined, updatedAt: nowIso() }));
    } else {
      upsertBlockTranscript(d, { lessonId, blockId, cues: [], language: language ?? "en", source: "auto", status: "processing" });
    }
  });

  worker.queue.push(job);
  void runQueue();
  return { queued: true, state: { stage: "queued", queuedAt: job.queuedAt } };
}

/**
 * Stop a queued or running job for a block (cancel button, or its
 * transcript was deleted). A queued job's placeholder is settled here; a
 * running one settles itself when its work notices the abort. Returns
 * whether a job was stopped.
 */
export async function cancelAutoTranscript(lessonId: string, blockId: string): Promise<boolean> {
  const k = key(lessonId, blockId);
  const before = worker.queue.length;
  worker.queue = worker.queue.filter((j) => key(j.lessonId, j.blockId) !== k);
  const dequeued = worker.queue.length !== before;
  let stopped = dequeued;
  if (worker.current && key(worker.current.job.lessonId, worker.current.job.blockId) === k) {
    worker.current.abort.abort();
    stopped = true;
  }
  if (dequeued) {
    await mutate((d) => {
      patchBlockTranscript(d, lessonId, blockId, (row) => ({ status: row.cues.length ? "ready" : "failed", error: CANCELLED_MESSAGE, updatedAt: nowIso() }));
    });
  }
  return stopped;
}

/* ------------------------------------------------------------------ */
/* Worker                                                               */
/* ------------------------------------------------------------------ */

async function runQueue(): Promise<void> {
  if (worker.running) return;
  worker.running = true;
  try {
    for (let job = worker.queue.shift(); job; job = worker.queue.shift()) {
      const abort = new AbortController();
      worker.current = { job, abort, state: { stage: "extracting", queuedAt: job.queuedAt, startedAt: nowIso() } };
      try {
        await processJob(job, abort.signal);
      } catch (err) {
        await recordFailure(job, err);
      } finally {
        worker.current = null;
      }
    }
  } finally {
    worker.running = false;
  }
}

function setStage(stage: TranscriptionStage, extra: Partial<TranscriptionJobState> = {}) {
  if (worker.current) worker.current.state = { ...worker.current.state, stage, ...extra };
}

/**
 * Where ffmpeg reads the block's video: the stored upload (a local path, or
 * a presigned URL to the app's own object storage), or, for a pasted
 * address, a copy downloaded into `workDir` first. An untrusted URL is never
 * handed to ffmpeg: ffmpeg follows redirects and the URIs inside playlists,
 * so it could be steered at the server's own network. The download checks
 * every resolved address and every redirect instead (`source-download.ts`).
 */
async function sourceInput(src: string, workDir: string, signal: AbortSignal): Promise<string> {
  const clean = stripMediaToken(src);
  const storageKey = storageKeyFromUrl(clean, siteOrigins());
  if (storageKey) {
    const driver = await storageFor(storageKey);
    if (!(await driver.head(storageKey))) throw new TranscriptionError("The video file could not be found in storage.");
    return (await driver.processingInput(storageKey, SOURCE_URL_TTL_SECONDS)).input;
  }
  if (!isPublicMediaUrl(clean)) throw new TranscriptionError("This video's address cannot be read by the server. Upload the file, or use a public http(s) link.");
  const file = path.join(workDir, "source.media");
  try {
    await downloadPublicMedia(clean, file, { signal });
  } catch (err) {
    if (signal.aborted) throw new TranscriptionCancelled();
    if (err instanceof SourceDownloadError) throw new TranscriptionError(err.message);
    throw new TranscriptionError("The video could not be downloaded for transcription.");
  }
  return file;
}

async function extractAudio(input: string, workDir: string, signal: AbortSignal): Promise<{ files: string[]; codec: AudioCodec }> {
  for (const codec of ["mp3", "wav"] as const) {
    try {
      await runFfmpeg(audioExtractArgs(input, codec), { cwd: workDir, signal, stallMs: EXTRACT_STALL_MS, timeoutMs: 3 * 3600_000 });
    } catch (err) {
      if (signal.aborted) throw new TranscriptionCancelled();
      if (codec === "mp3" && err instanceof FfmpegError && isMissingEncoderError(err.stderr)) continue;
      if (err instanceof FfmpegError && /matches no streams|does not contain any stream|Output file .* does not contain/i.test(err.stderr)) {
        throw new TranscriptionError("This video has no audio track to transcribe.");
      }
      if (err instanceof FfmpegError && isRefusedInputError(err.stderr)) {
        throw new TranscriptionError("This file is not a video format that can be transcribed (MP4, WebM, MOV, MKV, Ogg or an audio file). Streaming playlists are not supported.");
      }
      throw err;
    }
    const files = sortAudioParts(await fs.readdir(workDir), codec);
    if (!files.length) throw new TranscriptionError("No audio could be extracted from the video.");
    return { files, codec };
  }
  throw new TranscriptionError("ffmpeg could not encode the audio.");
}

async function postPart(file: string, codec: AudioCodec, opts: { language: string | null; prompt: string; signal: AbortSignal; words: boolean }): Promise<unknown> {
  const endpoint = transcriptionEndpoint(transcribeEnv.apiUrl);
  if (!endpoint || !transcribeEnv.apiKey) throw new TranscriptionError("The transcription API is not configured.");
  let words = opts.words;
  for (let attempt = 0; ; attempt++) {
    if (opts.signal.aborted) throw new TranscriptionCancelled();
    const form = new FormData();
    form.append("file", await openAsBlob(file, { type: codec === "mp3" ? "audio/mpeg" : "audio/wav" }), path.basename(file));
    form.append("model", transcribeEnv.model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    form.append("timestamp_granularities[]", "segment");
    if (words) form.append("timestamp_granularities[]", "word");
    const hint = languageHint(opts.language);
    if (hint) form.append("language", hint);
    if (opts.prompt) form.append("prompt", opts.prompt);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${transcribeEnv.apiKey}`, Accept: "application/json" },
        body: form,
        signal: AbortSignal.any([opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
    } catch (err) {
      if (opts.signal.aborted) throw new TranscriptionCancelled();
      if (attempt + 1 >= MAX_ATTEMPTS) {
        const timedOut = (err as { name?: string } | null)?.name === "TimeoutError";
        throw new TranscriptionError(timedOut ? "The transcription service did not answer in time." : "The transcription service could not be reached.");
      }
      await delay(retryAfterMs(null, attempt), opts.signal);
      continue;
    }
    const body = await res.text();
    if (res.ok) {
      try {
        return JSON.parse(body);
      } catch {
        throw new TranscriptionError("The transcription service returned something other than JSON. Check TRANSCRIBE_API_URL.");
      }
    }
    // Some compatible services reject word timestamps: retry once with segments only.
    if (res.status === 400 && words && /granularit|word/i.test(body)) {
      words = false;
      continue;
    }
    const retryable = res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500;
    if (!retryable || attempt + 1 >= MAX_ATTEMPTS) throw new TranscriptionError(apiErrorMessage(res.status, body));
    await delay(retryAfterMs(res.headers.get("retry-after"), attempt), opts.signal);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new TranscriptionCancelled());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TranscriptionCancelled());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function processJob(job: Job, signal: AbortSignal): Promise<void> {
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === job.lessonId);
  const block = findVideoBlock(lesson, job.blockId);
  if (!lesson || !block?.src) throw new TranscriptionCancelled("The video was removed before it was transcribed.");
  const sourceAtStart = stripMediaToken(block.src);

  const workDir = path.join(os.tmpdir(), "ll-transcribe", job.id);
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });
  try {
    setStage("extracting");
    const input = await sourceInput(block.src, workDir, signal);
    const { files, codec } = await extractAudio(input, workDir, signal);

    const parts: { offset: number; duration: number; segments: TimedSegment[] }[] = [];
    let offset = 0;
    let language = job.language;
    let prompt = "";
    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) throw new TranscriptionCancelled();
      setStage("transcribing", { part: i + 1, parts: files.length });
      const file = path.join(workDir, files[i]!);
      const [stat, probe] = await Promise.all([fs.stat(file), probeMedia(file).catch(() => null)]);
      const duration = probe?.duration && probe.duration > 0 ? probe.duration : Math.min(AUDIO_PART_SECONDS, Math.max(1, stat.size / 4000));
      if (stat.size > MAX_AUDIO_PART_BYTES) throw new TranscriptionError("An audio part is larger than the 25 MB the transcription API accepts.");
      // Tiny tail parts (a fraction of a second) carry no speech worth a request.
      if (duration < 0.5 && i > 0) {
        offset += duration;
        continue;
      }
      const body = await postPart(file, codec, { language, prompt, signal, words: true });
      const parsed = parseTranscriptionResponse(body, duration);
      if (!language && parsed.language) language = parsed.language;
      parts.push({ offset, duration, segments: parsed.segments });
      prompt = continuityPrompt(parsed.segments);
      offset += duration;
    }

    setStage("saving");
    const cues = segmentsToCues(mergePartSegments(parts));
    if (!cues.length) throw new TranscriptionError("No speech was recognized in this video.");

    const saved = await mutate((d) => {
      const l = d.lessons.find((x) => x.id === job.lessonId);
      const b = findVideoBlock(l, job.blockId);
      // The video was replaced while it was being transcribed: these cues belong to the old file.
      if (!b || stripMediaToken(b.src) !== sourceAtStart) return null;
      const current = blockTranscript(d, b);
      if (!job.manual && current && current.source !== "auto" && current.cues.length) return null;
      return upsertBlockTranscript(d, { lessonId: job.lessonId, blockId: job.blockId, cues, language: language ?? current?.language ?? "en", source: "auto", status: "ready" });
    });
    if (!saved) throw new TranscriptionCancelled("The video changed while it was being transcribed.");
    await notifyOutcome(job, "ready", `${cues.length} captions were generated.`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Last lines of ffmpeg's output for the error message, without addresses or server paths (presigned URLs carry signatures). */
function ffmpegDetail(stderr: string): string {
  return stderr
    .split("\n")
    .slice(-2)
    .join(" ")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[address]")
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.-]+){2,}/g, "[file]")
    .slice(0, 300);
}

async function recordFailure(job: Job, err: unknown): Promise<void> {
  const cancelled = err instanceof TranscriptionCancelled;
  const message =
    err instanceof TranscriptionError || err instanceof TranscriptionCancelled
      ? err.message
      : err instanceof FfmpegError
        ? `${err.message}${err.stderr ? ` ${ffmpegDetail(err.stderr)}` : ""}`
        : "Something went wrong while generating the transcript.";
  if (!(err instanceof TranscriptionError) && !cancelled) console.error("[transcripts] automatic transcription failed:", err instanceof Error ? err.message : err);
  await mutate((d) => {
    const lesson = d.lessons.find((l) => l.id === job.lessonId);
    const t = blockTranscript(d, findVideoBlock(lesson, job.blockId));
    if (!t) return;
    // Earlier cues stay usable; only a transcript that never had any is marked failed.
    patchBlockTranscript(d, job.lessonId, job.blockId, (row) => ({
      status: row.cues.length ? "ready" : "failed",
      error: message,
      updatedAt: nowIso(),
    }));
  }).catch(() => undefined);
  if (!cancelled) await notifyOutcome(job, "failed", message);
}

async function notifyOutcome(job: Job, outcome: "ready" | "failed", detail: string): Promise<void> {
  try {
    const db = await getDb();
    const lesson = db.lessons.find((l) => l.id === job.lessonId);
    const course = lesson ? db.courses.find((c) => c.id === lesson.courseId) : null;
    if (!lesson || !course) return;
    const recipients = Array.from(new Set([...course.instructorIds, course.createdById, ...(job.requestedBy ? [job.requestedBy] : [])])).filter(Boolean);
    await notifyMany(recipients, {
      type: "system",
      subject: outcome === "ready" ? `Transcript ready: ${lesson.title}` : `Transcript could not be generated: ${lesson.title}`,
      message: outcome === "ready" ? `${detail} Review and correct them in the transcript editor.` : detail,
      link: `/admin/courses/${course.id}/lessons/${lesson.id}/transcript?block=${encodeURIComponent(job.blockId)}`,
      email: outcome === "failed",
      dedupeKey: `transcript:${job.id}:${outcome}`,
    });
  } catch (err) {
    console.error("[transcripts] could not notify instructors:", err instanceof Error ? err.message : err);
  }
}

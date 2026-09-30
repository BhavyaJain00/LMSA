import "server-only";
import { execFile, spawn } from "node:child_process";
import { mediaEnv } from "@/lib/server-env";
import { FfmpegProgressParser, parseProbe, tailText, type FfmpegProgress, type ProbeInfo } from "./plan";

/**
 * ffmpeg/ffprobe detection and process runner.
 *
 * Binaries come from FFMPEG_PATH / FFPROBE_PATH (default: the ones on PATH).
 * Detection runs `-version` once and is cached for the life of the process;
 * Settings → Storage & video can force a fresh check after installing ffmpeg.
 * Processes are started with argument arrays (never a shell), hidden on
 * Windows, and killed when they stop reporting progress.
 */

export interface FfmpegStatus {
  available: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  /** Why ffmpeg is unusable, e.g. "ffmpeg was not found". */
  error: string | null;
  checkedAt: string;
}

interface DetectCache {
  status?: FfmpegStatus;
  pending?: Promise<FfmpegStatus>;
}

const g = globalThis as unknown as { __llFfmpeg?: DetectCache };
const cache: DetectCache = (g.__llFfmpeg ??= {});

const VERSION_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 60_000;

/** Install hint shown when ffmpeg is missing. */
export const FFMPEG_INSTALL_HINT = "Install it (`winget install Gyan.FFmpeg` on Windows, `apt install ffmpeg` on Linux) or set FFMPEG_PATH and FFPROBE_PATH.";

function versionOf(binary: string): Promise<{ version: string | null; error: string | null }> {
  return new Promise((resolve) => {
    execFile(binary, ["-version"], { timeout: VERSION_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        resolve({ version: null, error: code === "ENOENT" ? "not found" : err.message.split("\n")[0]!.slice(0, 200) });
        return;
      }
      const first = String(stdout).split(/\r?\n/)[0] ?? "";
      const m = /version\s+(\S+)/i.exec(first);
      resolve({ version: m ? m[1]! : first.slice(0, 60) || "unknown", error: null });
    });
  });
}

async function detect(): Promise<FfmpegStatus> {
  const [ff, probe] = await Promise.all([versionOf(mediaEnv.ffmpegPath), versionOf(mediaEnv.ffprobePath)]);
  const problems: string[] = [];
  if (ff.error) problems.push(`ffmpeg ${ff.error === "not found" ? "was not found" : `failed: ${ff.error}`}`);
  if (probe.error) problems.push(`ffprobe ${probe.error === "not found" ? "was not found" : `failed: ${probe.error}`}`);
  return {
    available: !ff.error && !probe.error,
    ffmpegPath: mediaEnv.ffmpegPath,
    ffprobePath: mediaEnv.ffprobePath,
    ffmpegVersion: ff.version,
    ffprobeVersion: probe.version,
    error: problems.length ? problems.join("; ") : null,
    checkedAt: new Date().toISOString(),
  };
}

/** Whether ffmpeg and ffprobe can run (cached; `force` re-checks). */
export async function detectFfmpeg(force = false): Promise<FfmpegStatus> {
  if (cache.status && !force) return cache.status;
  if (!cache.pending) {
    cache.pending = detect()
      .then((status) => (cache.status = status))
      .finally(() => (cache.pending = undefined));
  }
  return cache.pending;
}

export class FfmpegError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr = "") {
    super(message);
    this.name = "FfmpegError";
    this.stderr = stderr;
  }
}

/** Run ffprobe on a file path or URL. */
export function probeMedia(input: string): Promise<ProbeInfo> {
  return new Promise((resolve, reject) => {
    execFile(
      mediaEnv.ffprobePath,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new FfmpegError("ffprobe could not read the video. The file may be damaged or in an unsupported format.", tailText(String(stderr || err.message))));
          return;
        }
        try {
          resolve(parseProbe(JSON.parse(String(stdout))));
        } catch {
          reject(new FfmpegError("ffprobe returned output that could not be read.", tailText(String(stdout))));
        }
      },
    );
  });
}

export interface RunOptions {
  cwd: string;
  onProgress?: (progress: FfmpegProgress) => void;
  signal?: AbortSignal;
  /** Kill the process when it reports no progress (and writes nothing) for this long. */
  stallMs?: number;
  /** Hard limit for the whole run. */
  timeoutMs?: number;
}

const STDERR_KEEP = 16 * 1024;

/** Run ffmpeg; resolves with the stderr tail on exit code 0, rejects with `FfmpegError` otherwise. */
export function runFfmpeg(args: string[], opts: RunOptions): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new FfmpegError("Cancelled."));
      return;
    }
    const child = spawn(mediaEnv.ffmpegPath, args, { cwd: opts.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const parser = new FfmpegProgressParser();
    let stderr = "";
    let killedFor: string | null = null;
    let lastActivity = Date.now();

    const kill = (reason: string) => {
      if (killedFor) return;
      killedFor = reason;
      child.kill("SIGKILL");
    };
    const watchdog = setInterval(() => {
      if (opts.stallMs && Date.now() - lastActivity > opts.stallMs) kill("ffmpeg stopped making progress and was stopped.");
    }, 5_000);
    const hardLimit = opts.timeoutMs ? setTimeout(() => kill("The conversion took too long and was stopped."), opts.timeoutMs) : null;
    const onAbort = () => kill("Cancelled.");
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      lastActivity = Date.now();
      const update = parser.push(chunk);
      if (update) opts.onProgress?.(update);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      lastActivity = Date.now();
      stderr = (stderr + chunk).slice(-STDERR_KEEP);
    });

    const finish = () => {
      clearInterval(watchdog);
      if (hardLimit) clearTimeout(hardLimit);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (err) => {
      finish();
      const code = (err as NodeJS.ErrnoException).code;
      reject(new FfmpegError(code === "ENOENT" ? `ffmpeg was not found. ${FFMPEG_INSTALL_HINT}` : `ffmpeg could not start: ${err.message}`));
    });
    child.on("close", (code) => {
      finish();
      const tail = tailText(stderr);
      if (killedFor) reject(new FfmpegError(killedFor, tail));
      else if (code === 0) resolve({ stderr: tail });
      else reject(new FfmpegError(`ffmpeg exited with code ${code ?? "unknown"}.`, tail));
    });
  });
}

import type { ByteRange } from "./playlist";

/**
 * Network helpers for the HLS engine: fetch with a timeout, byte ranges and
 * download progress (for throughput measurement and abandoning slow
 * downloads), plus abortable sleeping and waiting for connectivity.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

export class TimeoutError extends Error {
  constructor() {
    super("The request timed out.");
    this.name = "TimeoutError";
  }
}

export function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "AbortError";
}

export interface LoadResult {
  data: ArrayBuffer;
  /** Milliseconds from request start to the last byte. */
  ms: number;
  bytes: number;
}

export interface LoadOptions {
  range?: ByteRange;
  signal?: AbortSignal;
  timeoutMs: number;
  /** Called while the body streams in. */
  onProgress?: (loaded: number, total: number | null, elapsedMs: number) => void;
}

/** GET `url` as bytes. Rejects with HttpError, TimeoutError or an AbortError. */
export async function loadBytes(url: string, opts: LoadOptions): Promise<LoadResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      throw abortError();
    }
    opts.signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const started = performance.now();
  try {
    const headers: Record<string, string> = {};
    if (opts.range) headers.Range = `bytes=${opts.range.offset}-${opts.range.offset + opts.range.length - 1}`;
    const res = await fetch(url, { signal: controller.signal, headers, credentials: "same-origin" });
    if (!res.ok) throw new HttpError(res.status, url);
    const lengthHeader = Number(res.headers.get("content-length"));
    const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;

    let data: ArrayBuffer;
    const reader = res.body?.getReader();
    if (!reader) {
      data = await res.arrayBuffer();
    } else {
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        opts.onProgress?.(loaded, total, performance.now() - started);
      }
      const out = new Uint8Array(loaded);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
      }
      data = out.buffer;
    }
    // A server that ignores Range answers 200 with the whole resource.
    if (opts.range && res.status === 200 && data.byteLength > opts.range.length) {
      data = data.slice(opts.range.offset, opts.range.offset + opts.range.length);
    }
    return { data, ms: performance.now() - started, bytes: data.byteLength };
  } catch (err) {
    if (timedOut) throw new TimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

export async function loadText(url: string, opts: Omit<LoadOptions, "range" | "onProgress">): Promise<{ text: string; url: string }> {
  const { data } = await loadBytes(url, opts);
  return { text: new TextDecoder().decode(data), url };
}

/** Resolve after `ms`, or reject with an AbortError when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Resolve when the browser is back online (immediately when it is online). */
export function waitOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener("online", done);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      window.removeEventListener("online", done);
      reject(abortError());
    };
    window.addEventListener("online", done);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

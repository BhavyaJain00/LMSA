import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { EMPTY_PAYLOAD_SHA256, awsUriEncode, presignUrl, sha256Hex, signRequest, type SigV4Credentials } from "./sigv4";

/**
 * Minimal S3 client on `fetch` + hand-written SigV4 (no SDK).
 *
 * Works with AWS S3, Cloudflare R2, Backblaze B2 and MinIO: set `endpoint`
 * for anything but AWS. Path-style URLs (`endpoint/bucket/key`) are used
 * when `forcePathStyle` is set and automatically for endpoints addressed by
 * IP or `localhost` (MinIO) and for bucket names containing dots. Bodies are
 * sent as bounded byte buffers (single PUTs up to the multipart threshold,
 * then one part at a time), so payloads are hashed and signed and no whole
 * file is ever held in memory.
 *
 * Every request is safe to repeat (parts and objects are overwritten, deletes
 * of missing objects succeed), so network failures, throttling and 5xx
 * answers are retried with exponential backoff. A server whose clock is off
 * is handled by signing with the time the storage service reports.
 */

export interface S3Config {
  /** e.g. "https://<account>.r2.cloudflarestorage.com"; empty = AWS for `region`. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  sessionToken?: string;
}

export class S3Error extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "S3Error";
    this.status = status;
    this.code = code;
  }
}

export interface S3ObjectInfo {
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export interface S3PartResult {
  partNumber: number;
  etag: string;
}

type Query = [string, string][];

/** Longest error body read from S3 (they are small XML documents). */
const MAX_ERROR_BODY = 16 * 1024;
/** Time allowed for a request to be answered, plus the time its body needs at the slowest upload speed tolerated. */
const REQUEST_TIMEOUT_MS = 30_000;
const MIN_UPLOAD_BYTES_PER_SECOND = 50_000;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 300;
const MAX_RETRY_AFTER_MS = 10_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(["RequestTimeout", "SlowDown", "InternalError", "ServiceUnavailable", "OperationAborted"]);
/** Most keys one DeleteObjects request may name. */
export const MAX_DELETE_BATCH = 1000;

function hostnameOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

/**
 * Region used in signatures. An explicit region always wins. "auto" (the
 * default) stays "auto" on Cloudflare R2, is read from the host name for
 * AWS, Backblaze B2 and Wasabi endpoints (`s3.<region>.…`), and is
 * "us-east-1" otherwise — what AWS without an endpoint, MinIO and most other
 * S3-compatible services expect.
 */
export function resolveSigningRegion(endpoint: string, region: string): string {
  const explicit = region.trim();
  if (explicit && explicit.toLowerCase() !== "auto") return explicit;
  const host = hostnameOf(endpoint);
  if (host.endsWith(".r2.cloudflarestorage.com")) return "auto";
  const m = /(?:^|\.)s3[.-](?:dualstack\.)?([a-z0-9-]+)\.(?:amazonaws\.com|backblazeb2\.com|wasabisys\.com)$/.exec(host);
  return m ? m[1]! : "us-east-1";
}

/**
 * Whether objects are addressed as `host/bucket/key` instead of
 * `bucket.host/key`: on request, for endpoints given as an IP address or
 * `localhost` (no per-bucket DNS names), and for bucket names with dots
 * (wildcard TLS certificates do not cover them).
 */
export function usesPathStyle(config: Pick<S3Config, "endpoint" | "bucket" | "forcePathStyle">): boolean {
  if (config.forcePathStyle || config.bucket.includes(".")) return true;
  if (!config.endpoint) return false;
  const host = hostnameOf(config.endpoint);
  return host === "localhost" || host.endsWith(".localhost") || isIP(host) !== 0;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait before retry number `attempt`: the service's `Retry-After` (seconds, capped), else 0.3 s doubling each time, with jitter. */
export function retryDelayMs(attempt: number, retryAfter: string | null, random: () => number = Math.random): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter.trim() || NaN);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return Math.round(RETRY_BASE_MS * 2 ** (attempt - 1) * (1 + random() * 0.25));
}

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Text of the first `<tag>` element, decoded. */
export function xmlText(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? xmlDecode(m[1]!) : null;
}

/** Raw (still encoded) contents of every `<tag>` element. */
function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]!);
  return out;
}

/** Texts of every `<tag>` element, decoded. */
export function xmlTexts(xml: string, tag: string): string[] {
  return xmlBlocks(xml, tag).map(xmlDecode);
}

async function readBounded(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).subarray(0, max).toString("utf8");
}

export interface S3ClientOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Waits between retries (replaced in tests). */
  sleep?: (ms: number) => Promise<void>;
}

interface SendOptions {
  query?: Query;
  headers?: Record<string, string>;
  body?: Uint8Array;
  /** Non-2xx statuses returned to the caller instead of thrown. */
  allow?: number[];
  signal?: AbortSignal;
  /** The caller streams the response body: only the wait for the response headers is limited. */
  stream?: boolean;
}

export class S3Client {
  private readonly config: S3Config;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Signing region (see `resolveSigningRegion`). */
  readonly region: string;
  readonly pathStyle: boolean;
  /** Correction applied to the local clock after the service reported it as skewed. */
  private clockOffsetMs = 0;

  constructor(config: S3Config, opts: S3ClientOptions = {}) {
    this.config = { ...config, endpoint: config.endpoint.replace(/\/+$/, "") };
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? defaultSleep;
    this.region = resolveSigningRegion(this.config.endpoint, this.config.region);
    this.pathStyle = usesPathStyle(this.config);
  }

  get bucket(): string {
    return this.config.bucket;
  }

  private get credentials(): SigV4Credentials {
    return { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey, sessionToken: this.config.sessionToken };
  }

  private signingDate(): Date {
    return new Date(this.now().getTime() + this.clockOffsetMs);
  }

  /** Protocol, host and decoded path of an object (or the bucket when `key` is empty). */
  target(key: string): { protocol: string; host: string; path: string } {
    const inBucket = `/${this.config.bucket}${key ? `/${key}` : ""}`;
    const atRoot = key ? `/${key}` : "/";
    if (!this.config.endpoint) {
      const awsHost = `s3.${this.region}.amazonaws.com`;
      return this.pathStyle ? { protocol: "https:", host: awsHost, path: inBucket } : { protocol: "https:", host: `${this.config.bucket}.${awsHost}`, path: atRoot };
    }
    const base = new URL(this.config.endpoint);
    const basePath = decodeURIComponent(base.pathname.replace(/\/+$/, ""));
    if (this.pathStyle) return { protocol: base.protocol, host: base.host, path: `${basePath}${inBucket}` };
    return { protocol: base.protocol, host: `${this.config.bucket}.${base.host}`, path: `${basePath}${atRoot}` };
  }

  private urlFor(key: string, query: Query): string {
    const t = this.target(key);
    const qs = query.map(([k, v]) => (v === "" ? awsUriEncode(k) : `${awsUriEncode(k)}=${awsUriEncode(v)}`)).join("&");
    return `${t.protocol}//${t.host}${awsUriEncode(t.path, false)}${qs ? `?${qs}` : ""}`;
  }

  /**
   * One attempt. The time limit covers the whole exchange, except for
   * streamed answers: their body may take as long as its reader needs (a
   * paused video), so only the wait for the response headers is limited.
   */
  private async fetchOnce(url: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array }, timeoutMs: number, signal: AbortSignal | undefined, stream: boolean): Promise<Response> {
    const request = { method: init.method, headers: init.headers, body: init.body as BodyInit | undefined, redirect: "manual", cache: "no-store" } as const;
    if (!stream) {
      const timeout = AbortSignal.timeout(timeoutMs);
      return this.fetchImpl(url, { ...request, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("The storage service did not answer in time.", "TimeoutError")), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...request, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send a signed request; throws `S3Error` for non-2xx answers (except
   * statuses in `allow`). Network failures, throttling and 5xx answers are
   * retried with backoff (a timeout only once); each attempt is signed afresh.
   */
  private async send(method: string, key: string, opts: SendOptions = {}): Promise<Response> {
    const t = this.target(key);
    const payloadHash = opts.body ? sha256Hex(opts.body) : EMPTY_PAYLOAD_SHA256;
    const url = this.urlFor(key, opts.query ?? []);
    const timeoutMs = REQUEST_TIMEOUT_MS + Math.ceil(((opts.body?.byteLength ?? 0) / MIN_UPLOAD_BYTES_PER_SECOND) * 1000);
    let timedOut = false;
    let clockAdopted = false;
    for (let attempt = 1; ; attempt++) {
      opts.signal?.throwIfAborted();
      const signed = signRequest({
        method,
        host: t.host,
        path: t.path,
        query: opts.query,
        headers: { ...(opts.headers ?? {}), "x-amz-content-sha256": payloadHash },
        payloadHash,
        credentials: this.credentials,
        scope: { region: this.region, service: "s3" },
        date: this.signingDate(),
      });
      let res: Response;
      try {
        res = await this.fetchOnce(url, { method, headers: signed.headers, body: opts.body }, timeoutMs, opts.signal, opts.stream === true);
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        const timeout = err instanceof Error && err.name === "TimeoutError";
        if (attempt >= MAX_ATTEMPTS || (timeout && timedOut)) throw err;
        timedOut ||= timeout;
        await this.sleep(retryDelayMs(attempt, null));
        continue;
      }
      if (res.ok || opts.allow?.includes(res.status)) return res;
      const error = await this.errorFrom(res, method, key);
      if (attempt >= MAX_ATTEMPTS) throw error;
      if (error.code === "RequestTimeTooSkewed" && !clockAdopted && this.adoptServerClock(res)) {
        clockAdopted = true;
        continue;
      }
      if (!RETRYABLE_STATUS.has(res.status) && !RETRYABLE_CODES.has(error.code)) throw error;
      await this.sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
    }
  }

  /** Sign with the service's time from now on (its `Date` header). False when the answer carries no usable date. */
  private adoptServerClock(res: Response): boolean {
    const serverTime = Date.parse(res.headers.get("date") ?? "");
    if (Number.isNaN(serverTime)) return false;
    this.clockOffsetMs = serverTime - this.now().getTime();
    return true;
  }

  private async errorFrom(res: Response, method: string, key: string): Promise<S3Error> {
    const text = method === "HEAD" ? "" : await readBounded(res, MAX_ERROR_BODY).catch(() => "");
    const code = xmlText(text, "Code") ?? `HTTP${res.status}`;
    // A request signed for (or sent to) the wrong region is answered with the bucket's real one.
    const bucketRegion = (res.headers.get("x-amz-bucket-region") ?? xmlText(text, "Region") ?? "").trim();
    if ([301, 307, 400].includes(res.status) && /^[a-z0-9-]{1,40}$/.test(bucketRegion) && bucketRegion !== this.region) {
      return new S3Error(res.status, code, `The bucket is in region "${bucketRegion}", not "${this.region}". Set S3_REGION=${bucketRegion}.`);
    }
    const message = xmlText(text, "Message") ?? `${method} ${key || "/"} failed with HTTP ${res.status}`;
    return new S3Error(res.status, code, message);
  }

  /** Upload a whole object in one request (for bodies up to the multipart threshold). */
  async putObject(key: string, body: Uint8Array, opts: { contentType?: string; cacheControl?: string; signal?: AbortSignal } = {}): Promise<{ etag: string | null }> {
    const headers: Record<string, string> = { "content-type": opts.contentType || "application/octet-stream" };
    if (opts.cacheControl) headers["cache-control"] = opts.cacheControl;
    const res = await this.send("PUT", key, { headers, body, signal: opts.signal });
    await res.body?.cancel().catch(() => undefined);
    return { etag: res.headers.get("etag") };
  }

  async createMultipartUpload(key: string, opts: { contentType?: string; cacheControl?: string } = {}): Promise<string> {
    const headers: Record<string, string> = { "content-type": opts.contentType || "application/octet-stream" };
    if (opts.cacheControl) headers["cache-control"] = opts.cacheControl;
    const res = await this.send("POST", key, { query: [["uploads", ""]], headers });
    const xml = await res.text();
    const uploadId = xmlText(xml, "UploadId");
    if (!uploadId) throw new S3Error(500, "InvalidResponse", "The storage service did not return an upload id.");
    return uploadId;
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, body: Uint8Array, signal?: AbortSignal): Promise<S3PartResult> {
    const res = await this.send("PUT", key, {
      query: [
        ["partNumber", String(partNumber)],
        ["uploadId", uploadId],
      ],
      body,
      signal,
    });
    await res.body?.cancel().catch(() => undefined);
    const etag = res.headers.get("etag");
    if (!etag) throw new S3Error(500, "InvalidResponse", `Part ${partNumber} was stored without an ETag.`);
    return { partNumber, etag };
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: S3PartResult[]): Promise<void> {
    const xml =
      "<CompleteMultipartUpload>" +
      [...parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`)
        .join("") +
      "</CompleteMultipartUpload>";
    const body = Buffer.from(xml, "utf8");
    for (let attempt = 1; ; attempt++) {
      const res = await this.send("POST", key, { query: [["uploadId", uploadId]], headers: { "content-type": "application/xml" }, body });
      // S3 may answer 200 and still report a failure in the body; an internal error there is worth another try.
      const text = await res.text();
      if (!/<Error>/.test(text)) return;
      const error = new S3Error(500, xmlText(text, "Code") ?? "InternalError", xmlText(text, "Message") ?? "Completing the upload failed.");
      if (attempt >= MAX_ATTEMPTS || !RETRYABLE_CODES.has(error.code)) throw error;
      await this.sleep(retryDelayMs(attempt, null));
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const res = await this.send("DELETE", key, { query: [["uploadId", uploadId]], allow: [404] });
    await res.body?.cancel().catch(() => undefined);
  }

  /** Metadata of an object, or null when it does not exist. */
  async headObject(key: string): Promise<S3ObjectInfo | null> {
    const res = await this.send("HEAD", key, { allow: [404] });
    if (res.status === 404) return null;
    const lastModified = res.headers.get("last-modified");
    return {
      size: Number(res.headers.get("content-length") ?? 0),
      contentType: res.headers.get("content-type") ?? undefined,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: lastModified ? new Date(lastModified) : undefined,
    };
  }

  /**
   * Fetch an object (optionally a byte range). Returns null when it does not
   * exist; a 416 answer is returned as is so callers can relay it.
   */
  async getObject(key: string, opts: { range?: string; signal?: AbortSignal } = {}): Promise<Response | null> {
    const headers: Record<string, string> = {};
    if (opts.range) headers.range = opts.range;
    const res = await this.send("GET", key, { headers, allow: [404, 416], signal: opts.signal, stream: true });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return res;
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.send("DELETE", key, { allow: [404] });
    await res.body?.cancel().catch(() => undefined);
  }

  /**
   * Delete up to `MAX_DELETE_BATCH` objects in one request (DeleteObjects).
   * Returns the keys the service could not delete; missing keys count as
   * deleted. Throws `S3Error` when the service rejects the request itself
   * (some S3-compatible services do not implement it).
   */
  async deleteObjects(keys: readonly string[]): Promise<{ key: string; code: string; message: string }[]> {
    if (keys.length === 0) return [];
    if (keys.length > MAX_DELETE_BATCH) throw new Error(`At most ${MAX_DELETE_BATCH} objects can be deleted per request.`);
    const xml = `<Delete><Quiet>true</Quiet>${keys.map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`).join("")}</Delete>`;
    const body = Buffer.from(xml, "utf8");
    const res = await this.send("POST", "", {
      query: [["delete", ""]],
      headers: { "content-type": "application/xml", "content-md5": createHash("md5").update(body).digest("base64") },
      body,
    });
    const text = await res.text();
    return xmlBlocks(text, "Error").map((block) => ({
      key: xmlText(block, "Key") ?? "",
      code: xmlText(block, "Code") ?? "Error",
      message: xmlText(block, "Message") ?? "The object could not be deleted.",
    }));
  }

  /** Every key under `prefix` (ListObjectsV2, following continuation tokens). */
  async listKeys(prefix: string, limit = 100_000): Promise<string[]> {
    const keys: string[] = [];
    let token: string | null = null;
    do {
      const query: Query = [
        ["list-type", "2"],
        ["prefix", prefix],
      ];
      if (token) query.push(["continuation-token", token]);
      const res = await this.send("GET", "", { query });
      const xml = await res.text();
      keys.push(...xmlTexts(xml, "Key"));
      token = xmlText(xml, "IsTruncated") === "true" ? xmlText(xml, "NextContinuationToken") : null;
    } while (token && keys.length < limit);
    return keys;
  }

  /** Presigned GET URL (valid for `expiresSeconds`, at most 7 days). */
  presignGet(key: string, expiresSeconds: number, opts: { contentType?: string; contentDisposition?: string } = {}): string {
    const t = this.target(key);
    const query: [string, string][] = [];
    if (opts.contentType) query.push(["response-content-type", opts.contentType]);
    if (opts.contentDisposition) query.push(["response-content-disposition", opts.contentDisposition]);
    return presignUrl({
      method: "GET",
      protocol: t.protocol,
      host: t.host,
      path: t.path,
      query,
      credentials: this.credentials,
      scope: { region: this.region, service: "s3" },
      date: this.signingDate(),
      expiresSeconds,
    }).url;
  }
}

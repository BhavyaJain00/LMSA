import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isPublicAddress, urlHost } from "@/lib/webhooks/ssrf";
import { isPublicMediaUrl } from "./stt";

/**
 * Download of a lesson video that lives outside the upload store (a pasted
 * http(s) address), so automatic transcription can run ffmpeg on a local
 * file instead of handing it an untrusted URL.
 *
 * Course managers choose these addresses, and with outside instructors they
 * are not trusted, so the download must never reach the server's own
 * network (cloud metadata at 169.254.169.254, admin ports on localhost,
 * private ranges):
 *  - the URL text must pass `isPublicMediaUrl` (http/https, no credentials,
 *    no private or internal host), on the first request and on every
 *    redirect (followed by hand, at most `MAX_REDIRECTS` times);
 *  - the connection's DNS lookup refuses a name if any address it resolves
 *    to is private, and the socket's remote address is checked again once
 *    connected, so what was checked is what is connected to;
 *  - a size cap, a time limit for the response headers and a stall limit
 *    for the body bound what one request can cost;
 *  - nothing from the remote response body is ever shown to anyone.
 */

/** Largest video downloaded for transcription. */
export const MAX_SOURCE_BYTES = 4 * 1024 ** 3;
export const MAX_REDIRECTS = 5;
const HEADERS_TIMEOUT_MS = 30_000;
const BODY_STALL_MS = 60_000;

export class SourceDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceDownloadError";
  }
}

export type AddressResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

export interface SourceDownloadOptions {
  signal?: AbortSignal;
  /** Byte limit (default `MAX_SOURCE_BYTES`). */
  maxBytes?: number;
  /** Abort when the body stops arriving for this long (default 60 s). */
  stallMs?: number;
  /** Name resolution (default: the system resolver). */
  resolve?: AddressResolver;
  /** Which connected addresses are acceptable (default: public ones only). Tests use it to reach a local server. */
  isAllowedAddress?: (address: string) => boolean;
}

export interface SourceDownloadResult {
  bytes: number;
  contentType: string | null;
  /** Address the file was finally read from (after redirects). */
  url: string;
}

const systemResolve: AddressResolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => (error ? reject(error) : resolve(addresses)));
  });

/**
 * A `lookup` for `http.request` that resolves the name and hands the socket
 * only acceptable addresses. One refused address fails the whole name: a
 * name answering both public and internal addresses could be steered.
 */
export function guardedMediaLookup(resolve: AddressResolver, isAllowed: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (all) => {
        const family = options.family === 4 || options.family === 6 ? options.family : 0;
        const addresses = family ? all.filter((a) => a.family === family) : [...all];
        if (!all.length || !addresses.length) {
          callback(Object.assign(new Error(`${hostname} has no usable IP address.`), { code: "ENOTFOUND" }), "", 0);
          return;
        }
        const refused = all.find((a) => !isAllowed(a.address));
        if (refused) {
          callback(Object.assign(new SourceDownloadError(`${hostname} resolves to a private or reserved address.`), { code: "EBLOCKED" }), "", 0);
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: unknown) => callback(error as NodeJS.ErrnoException, "", 0),
    );
  };
}

/**
 * Where a redirect points, resolved against the URL that answered it.
 * Throws when the answer has no usable `Location` or points somewhere the
 * server may not go.
 */
export function redirectTarget(location: string | string[] | undefined, base: string): string {
  const value = Array.isArray(location) ? location[0] : location;
  if (!value) throw new SourceDownloadError("The video's address answered with a redirect without a destination.");
  let next: URL;
  try {
    next = new URL(value, base);
  } catch {
    throw new SourceDownloadError("The video's address redirected to an invalid address.");
  }
  next.hash = "";
  if (!isPublicMediaUrl(next.href)) throw new SourceDownloadError("The video's address redirected to a private or unsupported address, which the server will not open.");
  return next.href;
}

function abortError(): Error {
  return Object.assign(new Error("The download was cancelled."), { name: "AbortError" });
}

function tooLargeMessage(maxBytes: number): string {
  const size = maxBytes >= 1024 ** 3 ? `${Math.round((maxBytes / 1024 ** 3) * 10) / 10} GB` : `${Math.max(1, Math.round(maxBytes / 1024 ** 2))} MB`;
  return `The video is larger than ${size}, the most the server downloads for a transcript. Upload the file instead.`;
}

function describeError(error: unknown, host: string): string {
  if (error instanceof SourceDownloadError) return error.message;
  const code = (error as NodeJS.ErrnoException | null)?.code ?? "";
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `${host} could not be found (DNS lookup failed).`;
    case "ECONNREFUSED":
      return `${host} refused the connection.`;
    case "ECONNRESET":
    case "EPIPE":
      return `${host} closed the connection.`;
    case "ETIMEDOUT":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `${host} could not be reached.`;
    default:
      return code.startsWith("ERR_TLS") || code.includes("CERT") ? `The TLS certificate of ${host} is not valid.` : `The video could not be downloaded from ${host}.`;
  }
}

/** One GET; resolves with the response once its headers arrived. */
function get(url: string, opts: Required<Pick<SourceDownloadOptions, "isAllowedAddress">> & { lookup: LookupFunction; signal?: AbortSignal }): Promise<{ req: http.ClientRequest; res: http.IncomingMessage }> {
  const target = new URL(url);
  const host = urlHost(target);
  const transport = target.protocol === "https:" ? https : http;
  if (opts.signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const req = transport.request(target, {
      method: "GET",
      headers: { Accept: "video/*, audio/*;q=0.9, */*;q=0.5", "User-Agent": "LearnLoop-Transcriber/1.0", Connection: "close" },
      // A fresh socket per request: a pooled connection would skip the guarded lookup.
      agent: false,
      lookup: opts.lookup,
    });
    const fail = (error: unknown) =>
      settle(() => {
        req.destroy();
        reject(new SourceDownloadError(describeError(error, host)));
      });
    const timer = setTimeout(() => fail(new SourceDownloadError(`${host} did not answer in time.`)), HEADERS_TIMEOUT_MS);
    const onAbort = () =>
      settle(() => {
        req.destroy();
        reject(abortError());
      });
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    // Whatever the lookup returned (or for an IP literal, where no lookup runs), refuse a socket on a blocked address.
    req.on("socket", (socket) => {
      socket.once("connect", () => {
        const remote = socket.remoteAddress;
        if (remote && !opts.isAllowedAddress(remote)) fail(new SourceDownloadError(`${host} connected to a private or reserved address.`));
      });
    });
    req.on("error", fail);
    req.on("response", (res) => settle(() => resolve({ req, res })));
    req.end();
  });
}

/** Stream a response body into `file`, enforcing the size cap, the stall limit and the abort signal. */
function saveBody(req: http.ClientRequest, res: http.IncomingMessage, file: string, opts: { maxBytes: number; stallMs: number; signal?: AbortSignal; host: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let bytes = 0;
    let settled = false;
    let stall: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => finish(new SourceDownloadError(`${opts.host} stopped sending the video.`)), opts.stallMs);
    };
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(stall);
      opts.signal?.removeEventListener("abort", onAbort);
      if (error) {
        req.destroy();
        res.destroy();
        out.destroy();
        reject(error);
        return;
      }
      out.end(() => resolve(bytes));
    };
    const onAbort = () => finish(abortError());
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    arm();

    if (opts.signal?.aborted) onAbort();
    out.on("error", () => finish(new SourceDownloadError("The video could not be saved for transcription (is the server's temporary folder full?).")));
    res.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > opts.maxBytes) {
        finish(new SourceDownloadError(tooLargeMessage(opts.maxBytes)));
        return;
      }
      arm();
      if (!out.write(chunk)) {
        res.pause();
        out.once("drain", () => res.resume());
      }
    });
    res.on("end", () => {
      if (!res.complete) finish(new SourceDownloadError(`${opts.host} closed the connection before the whole video arrived.`));
      else finish(null);
    });
    res.on("error", () => finish(new SourceDownloadError(`${opts.host} closed the connection before the whole video arrived.`)));
    res.on("aborted", () => finish(new SourceDownloadError(`${opts.host} closed the connection before the whole video arrived.`)));
  });
}

/**
 * Download a public video to `file` (see the module comment for the
 * rules). Rejects with `SourceDownloadError` (a message safe to show the
 * requester) or an `AbortError` when `signal` aborts.
 */
export async function downloadPublicMedia(url: string, file: string, opts: SourceDownloadOptions = {}): Promise<SourceDownloadResult> {
  const isAllowedAddress = opts.isAllowedAddress ?? isPublicAddress;
  const lookup = guardedMediaLookup(opts.resolve ?? systemResolve, isAllowedAddress);
  const maxBytes = opts.maxBytes ?? MAX_SOURCE_BYTES;
  let current = url;
  if (!isPublicMediaUrl(current)) throw new SourceDownloadError("This video's address cannot be read by the server. Upload the file, or use a public http(s) link.");

  for (let hop = 0; ; hop++) {
    const { req, res } = await get(current, { lookup, isAllowedAddress, signal: opts.signal });
    const status = res.statusCode ?? 0;
    const host = urlHost(new URL(current));

    if (status >= 300 && status < 400 && status !== 304) {
      res.resume();
      req.destroy();
      if (hop >= MAX_REDIRECTS) throw new SourceDownloadError("The video's address redirected too many times.");
      current = redirectTarget(res.headers.location, current);
      continue;
    }
    if (status !== 200) {
      res.resume();
      req.destroy();
      throw new SourceDownloadError(`${host} answered HTTP ${status} when the video was requested.`);
    }
    const contentType = res.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() || null;
    if (contentType && /mpegurl|dash\+xml|text\/html/.test(contentType)) {
      res.resume();
      req.destroy();
      throw new SourceDownloadError(
        contentType.includes("html")
          ? "The video's address points to a web page, not to a video file. Use the file's direct address, or upload it."
          : "Streaming playlists cannot be transcribed. Use the address of the MP4 file, or upload it.",
      );
    }
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.resume();
      req.destroy();
      throw new SourceDownloadError(tooLargeMessage(maxBytes));
    }
    const bytes = await saveBody(req, res, file, { maxBytes, stallMs: opts.stallMs ?? BODY_STALL_MS, signal: opts.signal, host });
    if (!bytes) throw new SourceDownloadError(`${host} sent an empty file.`);
    return { bytes, contentType, url: current };
  }
}

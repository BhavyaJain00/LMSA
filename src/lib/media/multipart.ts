/**
 * Streaming `multipart/form-data` parser (RFC 7578 / RFC 2046), written on
 * Node/web built-ins only. Parts are handed to a sink chunk by chunk as they
 * arrive, so a multi-gigabyte upload never sits in memory: the parser only
 * keeps the bytes that could still be the start of the next boundary
 * (< boundary length) or, while reading part headers, at most
 * `maxHeaderBytes`.
 *
 * Pure module (no server-only imports) so it can be unit tested.
 */

export interface MultipartLimits {
  /** Largest header block of one part, in bytes. */
  maxHeaderBytes: number;
  /** Most parts accepted in one body. */
  maxParts: number;
  /** Bytes accepted before the first boundary (preamble). */
  maxPreambleBytes: number;
}

export const DEFAULT_MULTIPART_LIMITS: MultipartLimits = { maxHeaderBytes: 8 * 1024, maxParts: 16, maxPreambleBytes: 1024 };

export interface MultipartPart {
  /** Form field name. */
  name: string;
  /** File name for file fields (null for plain fields). Path components are removed. */
  filename: string | null;
  /** Lower-case media type without parameters ("" when the part has no Content-Type). */
  contentType: string;
  /** Lower-case header names → values. */
  headers: Record<string, string>;
}

/** Receives the body of one part. Returning a promise applies backpressure. */
export interface MultipartSink {
  write(chunk: Uint8Array): void | Promise<void>;
  end(): void | Promise<void>;
}

export type MultipartErrorCode = "malformed" | "too-many-parts" | "header-too-large" | "truncated";

export class MultipartError extends Error {
  readonly code: MultipartErrorCode;
  constructor(code: MultipartErrorCode, message: string) {
    super(message);
    this.name = "MultipartError";
    this.code = code;
  }
}

const BOUNDARY_CHARS = /^[0-9A-Za-z'()+_,\-./:=? ]{1,70}$/;

/** The boundary of a `multipart/form-data` Content-Type, or null when absent/invalid. */
export function multipartBoundary(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const [type, ...params] = splitHeaderParams(contentType);
  if (type?.toLowerCase() !== "multipart/form-data") return null;
  for (const param of params) {
    const eq = param.indexOf("=");
    if (eq === -1) continue;
    if (param.slice(0, eq).trim().toLowerCase() !== "boundary") continue;
    const value = unquote(param.slice(eq + 1).trim());
    if (!BOUNDARY_CHARS.test(value) || value.endsWith(" ")) return null;
    return value;
  }
  return null;
}

/** Split `a; b=1; c="x;y"` on semicolons outside quoted strings. */
function splitHeaderParams(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (quoted) {
      current += ch;
      if (ch === "\\" && i + 1 < value.length) current += value[++i];
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
      current += ch;
    } else if (ch === ";") {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\(.)/g, "$1");
  return value;
}

/** Browsers escape `"`, CR and LF in field and file names as %22, %0D and %0A (HTML multipart encoding). */
function decodeFormName(value: string): string {
  return value.replace(/%(22|0d|0a)/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeExtValue(value: string): string | null {
  // RFC 5987: charset'lang'pct-encoded
  const m = /^([\w!#$%&+^`{}~-]+)'[^']*'(.*)$/.exec(value);
  if (!m || m[1]!.toLowerCase() !== "utf-8") return null;
  try {
    return decodeURIComponent(m[2]!);
  } catch {
    return null;
  }
}

/** Parse `form-data; name="x"; filename="y"`. */
export function parseContentDisposition(value: string): { type: string; params: Record<string, string> } {
  const [type = "", ...rest] = splitHeaderParams(value);
  const params: Record<string, string> = {};
  for (const param of rest) {
    const eq = param.indexOf("=");
    if (eq === -1) continue;
    const key = param.slice(0, eq).trim().toLowerCase();
    const raw = param.slice(eq + 1).trim();
    if (key.endsWith("*")) {
      const decoded = decodeExtValue(unquote(raw));
      if (decoded !== null) params[key.slice(0, -1)] = decoded;
      continue;
    }
    // An extended value (filename*=) wins over the plain one.
    if (params[key] === undefined) params[key] = decodeFormName(unquote(raw));
  }
  return { type: type.toLowerCase(), params };
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let last: string | null = null;
  for (const line of block.split("\r\n")) {
    if (!line) continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && last) {
      headers[last] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) throw new MultipartError("malformed", "Invalid part header.");
    last = line.slice(0, colon).trim().toLowerCase();
    headers[last] = line.slice(colon + 1).trim();
  }
  return headers;
}

function baseName(filename: string): string {
  const parts = filename.split(/[\\/]/);
  return (parts[parts.length - 1] ?? "").trim();
}

function toPart(headers: Record<string, string>): MultipartPart {
  const disposition = headers["content-disposition"];
  if (!disposition) throw new MultipartError("malformed", "A form part has no Content-Disposition header.");
  const { type, params } = parseContentDisposition(disposition);
  if (type !== "form-data" || params.name === undefined) throw new MultipartError("malformed", "A form part has no field name.");
  const contentType = (headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  return { name: params.name, filename: params.filename !== undefined ? baseName(params.filename) : null, contentType, headers };
}

async function* iterate(source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  if (typeof (source as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (source as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  yield* source as AsyncIterable<Uint8Array>;
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

type State = "preamble" | "boundary" | "headers" | "body" | "done";

/**
 * Parse a multipart body. `onPart` is called with each part's headers and
 * returns the sink for its body. Errors thrown by `onPart` or a sink stop
 * parsing and are rethrown; the source is not cancelled, so the caller can
 * still drain it. Bytes after the closing boundary (epilogue) are not read.
 */
export async function parseMultipart(
  source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  boundary: string,
  onPart: (part: MultipartPart) => MultipartSink | Promise<MultipartSink>,
  limits: Partial<MultipartLimits> = {},
): Promise<void> {
  const { maxHeaderBytes, maxParts, maxPreambleBytes } = { ...DEFAULT_MULTIPART_LIMITS, ...limits };
  // Every delimiter is CRLF "--" boundary; a CRLF is prepended so the first one (at offset 0) matches too.
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const keep = delimiter.length - 1;
  let buffer: Buffer = Buffer.from(CRLF);
  let state = "preamble" as State;
  let preambleSeen = 0;
  let parts = 0;
  let sink: MultipartSink | null = null;

  const step = async (): Promise<boolean> => {
    switch (state) {
      case "preamble": {
        const at = buffer.indexOf(delimiter);
        if (at === -1) {
          const drop = Math.max(0, buffer.length - keep);
          preambleSeen += drop;
          buffer = buffer.subarray(drop);
          if (preambleSeen > maxPreambleBytes) throw new MultipartError("malformed", "The form data does not start with its boundary.");
          return false;
        }
        preambleSeen += at;
        if (preambleSeen > maxPreambleBytes) throw new MultipartError("malformed", "The form data does not start with its boundary.");
        buffer = buffer.subarray(at + delimiter.length);
        state = "boundary";
        return true;
      }
      case "boundary": {
        // After a delimiter: "--" closes the body; otherwise optional padding, then CRLF.
        if (buffer.length < 2) return false;
        if (buffer[0] === 0x2d && buffer[1] === 0x2d) {
          state = "done";
          return false;
        }
        let i = 0;
        while (i < buffer.length && (buffer[i] === 0x20 || buffer[i] === 0x09)) i++;
        if (i > 64) throw new MultipartError("malformed", "Invalid boundary line.");
        if (buffer.length < i + 2) return false;
        if (buffer[i] !== 0x0d || buffer[i + 1] !== 0x0a) throw new MultipartError("malformed", "Invalid boundary line.");
        buffer = buffer.subarray(i + 2);
        state = "headers";
        return true;
      }
      case "headers": {
        let block: string;
        if (buffer.length >= 2 && buffer[0] === 0x0d && buffer[1] === 0x0a) {
          block = "";
          buffer = buffer.subarray(2);
        } else {
          const at = buffer.indexOf(HEADER_END);
          if (at === -1) {
            if (buffer.length > maxHeaderBytes) throw new MultipartError("header-too-large", "A form part header is too large.");
            return false;
          }
          if (at > maxHeaderBytes) throw new MultipartError("header-too-large", "A form part header is too large.");
          block = buffer.subarray(0, at).toString("utf8");
          buffer = buffer.subarray(at + HEADER_END.length);
        }
        if (++parts > maxParts) throw new MultipartError("too-many-parts", "The form has too many fields.");
        sink = await onPart(toPart(parseHeaderBlock(block)));
        state = "body";
        return true;
      }
      case "body": {
        const at = buffer.indexOf(delimiter);
        if (at !== -1) {
          if (at > 0) await sink!.write(buffer.subarray(0, at));
          await sink!.end();
          sink = null;
          buffer = buffer.subarray(at + delimiter.length);
          state = "boundary";
          return true;
        }
        const safe = buffer.length - keep;
        if (safe > 0) {
          await sink!.write(buffer.subarray(0, safe));
          buffer = buffer.subarray(safe);
        }
        return false;
      }
      case "done":
        return false;
    }
  };

  for await (const chunk of iterate(source)) {
    if (!chunk.byteLength) continue;
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    while (await step()) {
      /* keep consuming the buffer */
    }
    if (state === "done") return;
  }
  if (state !== "done") throw new MultipartError("truncated", "The upload ended before the form data was complete.");
}

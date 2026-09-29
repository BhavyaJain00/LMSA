/**
 * Minimal, dependency-free MIME message builder (RFC 5322 / 2045 / 2046 / 2047).
 *
 * Produces a complete message (headers + body) ready for SMTP `DATA`:
 *  - `multipart/alternative` with a text/plain and a text/html part,
 *  - UTF-8 header values encoded as RFC 2047 encoded-words when needed,
 *  - bodies encoded as quoted-printable (mostly ASCII) or base64 (mostly
 *    non-ASCII), both wrapped to 76-character lines,
 *  - headers folded at whitespace to 78 characters where possible,
 *  - CRLF line endings throughout, so the output is 7-bit clean.
 *
 * This module is pure (no app imports, only `node:crypto` and `Buffer`) so it
 * can be unit-tested in isolation.
 */
import { randomBytes } from "node:crypto";

export const CRLF = "\r\n";
const MAX_LINE = 76;
const MAX_HEADER_LINE = 78;

export interface MailAddress {
  address: string;
  name?: string;
}

export interface MimeMessageInput {
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  replyTo?: MailAddress;
  subject: string;
  text: string;
  html?: string;
  /** Full Message-ID including angle brackets. Generated when omitted. */
  messageId?: string;
  date?: Date;
  /** Extra headers (ASCII, or plain UTF-8 text that will be encoded). Core headers cannot be overridden. */
  headers?: Record<string, string>;
}

export interface BuiltMessage {
  raw: string;
  messageId: string;
  /** Header lines (unfolded name/value pairs) for display. */
  headers: [string, string][];
}

/* ------------------------------------------------------------------ */
/* Character helpers                                                   */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line no-control-regex
const NON_ASCII_OR_CONTROL = /[^\x20-\x7e]/;

export function isPrintableAscii(value: string): boolean {
  return !NON_ASCII_OR_CONTROL.test(value);
}

/**
 * Make a string safe to use as a header value: CR/LF (header injection),
 * other control characters and runs of whitespace collapse to single spaces.
 */
export function sanitizeHeaderValue(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Normalize any line endings to CRLF. */
export function toCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, CRLF);
}

/* ------------------------------------------------------------------ */
/* RFC 2047 encoded-words                                              */
/* ------------------------------------------------------------------ */

/**
 * Split a string into chunks whose UTF-8 byte length is at most `maxBytes`,
 * never cutting a code point (or a surrogate pair) in half.
 */
export function chunkUtf8(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of value) {
    const bytes = Buffer.byteLength(ch, "utf8");
    if (currentBytes + bytes > maxBytes && current) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += bytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Encode a header text as one or more RFC 2047 "B" encoded-words when it
 * contains non-ASCII characters. Each encoded-word stays within 75 chars
 * (45 UTF-8 bytes → 60 base64 chars + 12 chars of framing), and adjacent
 * words are separated by a space so the header folds cleanly (whitespace
 * between adjacent encoded-words is ignored by decoders).
 */
export function encodeWords(value: string): string {
  const clean = sanitizeHeaderValue(value);
  if (isPrintableAscii(clean)) return clean;
  return chunkUtf8(clean, 45)
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join(" ");
}

/** Decode RFC 2047 encoded-words (used by tests and the admin header view). */
export function decodeWords(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _charset: string, enc: string, data: string) => {
      if (enc.toUpperCase() === "B") return Buffer.from(data, "base64").toString("utf8");
      const bytes: number[] = [];
      for (let i = 0; i < data.length; i++) {
        const c = data[i]!;
        if (c === "_") bytes.push(0x20);
        else if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(data.slice(i + 1, i + 3))) {
          bytes.push(parseInt(data.slice(i + 1, i + 3), 16));
          i += 2;
        } else bytes.push(c.charCodeAt(0));
      }
      return Buffer.from(bytes).toString("utf8");
    });
}

/* ------------------------------------------------------------------ */
/* Addresses                                                           */
/* ------------------------------------------------------------------ */

const ADDRESS_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]+$/;

/** Strict-enough validation for envelope addresses (no display names, no CR/LF, no spaces). */
export function isSafeAddress(address: string): boolean {
  if (address.length > 254) return false;
  if (!ADDRESS_RE.test(address)) return false;
  const [local, domain] = [address.slice(0, address.lastIndexOf("@")), address.slice(address.lastIndexOf("@") + 1)];
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (domain.startsWith(".") || domain.startsWith("-") || domain.includes("..")) return false;
  return true;
}

/** Whether the address needs the SMTPUTF8 extension (non-ASCII local part or domain). */
export function needsSmtpUtf8(address: string): boolean {
  return !isPrintableAscii(address);
}

/** Parse `Name <addr@x>`, `"Quoted, Name" <addr@x>` or `addr@x` into a MailAddress. Returns null when invalid. */
export function parseAddress(input: string): MailAddress | null {
  const value = sanitizeHeaderValue(input);
  if (!value) return null;
  const angle = /^(.*)<([^<>]+)>$/.exec(value);
  if (angle) {
    const address = angle[2]!.trim();
    let name = angle[1]!.trim();
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) name = name.slice(1, -1).replace(/\\(.)/g, "$1");
    if (!isSafeAddress(address)) return null;
    return name ? { address, name } : { address };
  }
  return isSafeAddress(value) ? { address: value } : null;
}

/** Characters that force a display name to be quoted (RFC 5322 "specials"). */
const SPECIALS = /[()<>[\]:;@\\,."]/;

/** Format a display name + address for a header, encoding non-ASCII names. */
export function formatAddress(addr: MailAddress): string {
  const address = sanitizeHeaderValue(addr.address);
  const name = addr.name ? sanitizeHeaderValue(addr.name) : "";
  if (!name) return address;
  let display: string;
  if (!isPrintableAscii(name)) display = encodeWords(name);
  else if (SPECIALS.test(name)) display = `"${name.replace(/(["\\])/g, "\\$1")}"`;
  else display = name;
  return `${display} <${address}>`;
}

/* ------------------------------------------------------------------ */
/* Header folding                                                      */
/* ------------------------------------------------------------------ */

/**
 * Fold a header so no line exceeds 78 characters where possible
 * (RFC 5322 §2.2.3): a CRLF is inserted before existing whitespace, so
 * unfolding (removing the CRLFs) restores the value exactly. Values without
 * whitespace (e.g. long URLs) stay on one line, which is still far below the
 * hard 998-character limit.
 */
export function foldHeader(name: string, value: string): string {
  let line = `${name}: ${value}`;
  if (line.length <= MAX_HEADER_LINE) return line;
  const out: string[] = [];
  let minIndex = name.length + 2;
  while (line.length > MAX_HEADER_LINE) {
    let idx = line.lastIndexOf(" ", MAX_HEADER_LINE);
    if (idx < minIndex) {
      idx = line.indexOf(" ", MAX_HEADER_LINE + 1);
      if (idx === -1) break;
    }
    out.push(line.slice(0, idx));
    line = line.slice(idx);
    minIndex = 1;
  }
  out.push(line);
  return out.join(CRLF);
}

/** Undo `foldHeader` (used by tests and header views). */
export function unfoldHeader(folded: string): string {
  return folded.replace(/\r\n(?=[ \t])/g, "");
}

/* ------------------------------------------------------------------ */
/* Body encodings                                                      */
/* ------------------------------------------------------------------ */

function hex(byte: number): string {
  return `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * Quoted-printable encoding (RFC 2045 §6.7) of UTF-8 text. Line breaks in the
 * input become hard CRLF breaks; long lines get soft breaks (`=` + CRLF) so no
 * encoded line exceeds 76 characters, never splitting an `=XX` escape.
 * Trailing spaces/tabs before a line break are encoded. A leading "." is
 * left as-is (SMTP dot-stuffing takes care of it) but a line starting with
 * "From " is protected so mbox-style mangling cannot alter the body.
 */
export function encodeQuotedPrintable(text: string): string {
  const out: string[] = [];
  const lines = text.replace(/\r\n|\r/g, "\n").split("\n");
  for (const line of lines) {
    const bytes = Buffer.from(line, "utf8");
    const tokens: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      const isLast = i === bytes.length - 1;
      if ((b === 0x20 || b === 0x09) && isLast) tokens.push(hex(b));
      else if (i === 0 && b === 0x46 && line.startsWith("From ")) tokens.push(hex(b));
      else if ((b >= 33 && b <= 126 && b !== 61) || b === 0x20 || b === 0x09) tokens.push(String.fromCharCode(b));
      else tokens.push(hex(b));
    }
    let current = "";
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t]!;
      const isLastToken = t === tokens.length - 1;
      // The final segment of a line may use all 76 characters; any other
      // segment must leave room for the soft-break "=".
      // (Whitespace before a soft break is safe: the "=" is the last character.)
      const limit = isLastToken ? MAX_LINE : MAX_LINE - 1;
      if (current.length + token.length > limit) {
        out.push(`${current}=`);
        current = "";
      }
      current += token;
    }
    out.push(current);
  }
  return out.join(CRLF);
}

/** Decode quoted-printable (used by tests and the admin source view). */
export function decodeQuotedPrintable(encoded: string): string {
  const joined = encoded.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i]!;
    if (c === "=" && /^[0-9A-F]{2}$/i.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(c, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n");
}

/** Base64 encoding wrapped to 76-character lines. */
export function encodeBase64Lines(text: string): string {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += MAX_LINE) lines.push(b64.slice(i, i + MAX_LINE));
  return lines.join(CRLF);
}

export type TransferEncoding = "quoted-printable" | "base64";

/** Pick the smaller encoding: QP for mostly-ASCII text, base64 otherwise. */
export function chooseEncoding(text: string): TransferEncoding {
  const bytes = Buffer.from(text, "utf8");
  if (!bytes.length) return "quoted-printable";
  let high = 0;
  for (const b of bytes) if (b > 126 || (b < 32 && b !== 10 && b !== 13 && b !== 9)) high++;
  return high / bytes.length > 0.2 ? "base64" : "quoted-printable";
}

function encodeBody(text: string, encoding: TransferEncoding): string {
  return encoding === "base64" ? encodeBase64Lines(text) : encodeQuotedPrintable(text);
}

/* ------------------------------------------------------------------ */
/* Dates & ids                                                         */
/* ------------------------------------------------------------------ */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 5322 date in UTC, e.g. "Tue, 29 Sep 2026 10:04:05 +0000". */
export function formatRfc5322Date(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/** A globally unique Message-ID for the given domain. */
export function createMessageId(domain: string): string {
  const safeDomain = /^[A-Za-z0-9.-]+$/.test(domain) ? domain : "localhost";
  return `<${Date.now().toString(36)}.${randomBytes(12).toString("hex")}@${safeDomain}>`;
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "localhost" : address.slice(at + 1).toLowerCase();
}

function boundary(): string {
  return `=_ll_${randomBytes(12).toString("hex")}`;
}

/* ------------------------------------------------------------------ */
/* Message builder                                                     */
/* ------------------------------------------------------------------ */

/** Headers generated by the builder; custom headers with these names are ignored. */
const RESERVED_HEADERS = new Set([
  "from",
  "to",
  "cc",
  "bcc",
  "reply-to",
  "subject",
  "date",
  "message-id",
  "mime-version",
  "content-type",
  "content-transfer-encoding",
  "sender",
  "return-path",
]);

function partHeaders(contentType: string, encoding: TransferEncoding): string {
  return [`Content-Type: ${contentType}; charset=utf-8`, `Content-Transfer-Encoding: ${encoding}`].join(CRLF);
}

/** Build a complete RFC 5322 message with a text and (optional) HTML alternative. */
export function buildMimeMessage(input: MimeMessageInput): BuiltMessage {
  if (!input.to.length) throw new Error("A message needs at least one recipient.");
  const messageId = input.messageId ?? createMessageId(domainOf(input.from.address));
  const headers: [string, string][] = [];
  headers.push(["From", formatAddress(input.from)]);
  headers.push(["To", input.to.map(formatAddress).join(", ")]);
  if (input.cc?.length) headers.push(["Cc", input.cc.map(formatAddress).join(", ")]);
  if (input.replyTo) headers.push(["Reply-To", formatAddress(input.replyTo)]);
  headers.push(["Subject", encodeWords(input.subject)]);
  headers.push(["Date", formatRfc5322Date(input.date ?? new Date())]);
  headers.push(["Message-ID", sanitizeHeaderValue(messageId)]);
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (!/^[A-Za-z0-9-]+$/.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) continue;
    const clean = sanitizeHeaderValue(value);
    if (!clean) continue;
    headers.push([name, isPrintableAscii(clean) ? clean : encodeWords(clean)]);
  }
  headers.push(["MIME-Version", "1.0"]);

  const text = input.text.replace(/\r\n|\r/g, "\n");
  let body: string;
  if (input.html) {
    const b = boundary();
    headers.push(["Content-Type", `multipart/alternative; boundary="${b}"`]);
    const textEnc = chooseEncoding(text);
    const htmlEnc = chooseEncoding(input.html);
    body = [
      "This is a multi-part message in MIME format.",
      "",
      `--${b}`,
      partHeaders("text/plain", textEnc),
      "",
      encodeBody(text, textEnc),
      `--${b}`,
      partHeaders("text/html", htmlEnc),
      "",
      encodeBody(input.html, htmlEnc),
      `--${b}--`,
      "",
    ].join(CRLF);
  } else {
    const enc = chooseEncoding(text);
    headers.push(["Content-Type", "text/plain; charset=utf-8"]);
    headers.push(["Content-Transfer-Encoding", enc]);
    body = `${encodeBody(text, enc)}${CRLF}`;
  }

  const headerBlock = headers.map(([name, value]) => foldHeader(name, value)).join(CRLF);
  return { raw: `${headerBlock}${CRLF}${CRLF}${body}`, messageId, headers };
}

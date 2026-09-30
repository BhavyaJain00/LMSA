import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, hand-written on `node:crypto`.
 *
 * Used by the S3-compatible storage driver (AWS S3, Cloudflare R2, Backblaze
 * B2, MinIO …) for header-signed requests and presigned GET URLs. Pure
 * functions: every input — including the clock — is passed in, so the
 * signer is checked against the example vectors from the AWS documentation.
 *
 * Paths are given DECODED ("/bucket/my file.mp4") and encoded exactly once
 * here, the way S3 expects (S3 does not double-encode like other services).
 * The request URL must be built with `awsUriEncode(path, false)` too, so the
 * bytes on the wire match what was signed.
 */

export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";
/** Payload hash for requests whose body is not hashed (presigned URLs). */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
/** SHA-256 of the empty string. */
export const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/** Longest lifetime AWS accepts for a presigned URL (7 days). */
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Temporary credentials (STS) only. */
  sessionToken?: string;
}

export interface SigV4Scope {
  region: string;
  service: string;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** `20130524T000000Z` */
export function amzDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** `20130524` */
export function amzDate(date: Date): string {
  return amzDateTime(date).slice(0, 8);
}

/**
 * URI-encode per the SigV4 rules: every byte except the unreserved
 * characters `A–Z a–z 0–9 - . _ ~` becomes `%XX` (upper-case hex). The slash
 * is kept when encoding an object path.
 */
export function awsUriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const unreserved =
      (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || byte === 0x2d || byte === 0x2e || byte === 0x5f || byte === 0x7e;
    if (unreserved || (byte === 0x2f && !encodeSlash)) out += String.fromCharCode(byte);
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Sorted, encoded query string: `a=1&b=&c=3`. */
export function canonicalQueryString(query: readonly (readonly [string, string])[]): string {
  return query
    .map(([k, v]) => [awsUriEncode(k), awsUriEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Lower-cased, trimmed, sorted headers and the `;`-joined list of their names. */
export function canonicalHeaders(headers: Record<string, string>): { canonical: string; signedHeaders: string } {
  const merged = new Map<string, string[]>();
  for (const [name, value] of Object.entries(headers)) {
    const key = name.trim().toLowerCase();
    const clean = String(value).trim().replace(/\s+/g, " ");
    merged.set(key, [...(merged.get(key) ?? []), clean]);
  }
  const names = Array.from(merged.keys()).sort();
  return {
    canonical: names.map((n) => `${n}:${merged.get(n)!.join(",")}\n`).join(""),
    signedHeaders: names.join(";"),
  };
}

export function credentialScope(date: Date, scope: SigV4Scope): string {
  return `${amzDate(date)}/${scope.region}/${scope.service}/aws4_request`;
}

export function deriveSigningKey(secretAccessKey: string, date: Date, scope: SigV4Scope): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, amzDate(date));
  const kRegion = hmac(kDate, scope.region);
  const kService = hmac(kRegion, scope.service);
  return hmac(kService, "aws4_request");
}

export interface CanonicalRequestInput {
  method: string;
  /** Decoded path, starting with "/". */
  path: string;
  query?: readonly (readonly [string, string])[];
  /** Every header to sign, including `host`. */
  headers: Record<string, string>;
  payloadHash: string;
}

export function canonicalRequest(input: CanonicalRequestInput): { request: string; signedHeaders: string } {
  const { canonical, signedHeaders } = canonicalHeaders(input.headers);
  const request = [input.method.toUpperCase(), awsUriEncode(input.path || "/", false), canonicalQueryString(input.query ?? []), canonical, signedHeaders, input.payloadHash].join("\n");
  return { request, signedHeaders };
}

export function stringToSign(date: Date, scope: SigV4Scope, canonicalRequestText: string): string {
  return [SIGV4_ALGORITHM, amzDateTime(date), credentialScope(date, scope), sha256Hex(canonicalRequestText)].join("\n");
}

export interface SignRequestInput {
  method: string;
  /** `host[:port]` exactly as sent (default ports omitted). */
  host: string;
  /** Decoded path, starting with "/". */
  path: string;
  query?: readonly (readonly [string, string])[];
  /** Extra headers to send and sign (e.g. range, content-type, x-amz-content-sha256). */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body, `UNSIGNED-PAYLOAD`, or the empty-body hash. */
  payloadHash: string;
  credentials: SigV4Credentials;
  scope: SigV4Scope;
  date: Date;
  /** Add `x-amz-date` (and the session token) to the signed headers. Off only for vectors that sign a `date` header instead. */
  addAmzDate?: boolean;
}

export interface SignedRequest {
  /** Headers to send (everything signed except `host`, plus `authorization`). */
  headers: Record<string, string>;
  authorization: string;
  signature: string;
  signedHeaders: string;
  canonicalRequest: string;
  stringToSign: string;
}

/** Sign a request with an `Authorization` header. */
export function signRequest(input: SignRequestInput): SignedRequest {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
  headers.host = input.host;
  if (input.addAmzDate !== false) headers["x-amz-date"] = amzDateTime(input.date);
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;

  const { request, signedHeaders } = canonicalRequest({ method: input.method, path: input.path, query: input.query, headers, payloadHash: input.payloadHash });
  const toSign = stringToSign(input.date, input.scope, request);
  const signature = createHmac("sha256", deriveSigningKey(input.credentials.secretAccessKey, input.date, input.scope)).update(toSign, "utf8").digest("hex");
  const authorization = `${SIGV4_ALGORITHM} Credential=${input.credentials.accessKeyId}/${credentialScope(input.date, input.scope)}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const send: Record<string, string> = { ...headers, authorization };
  delete send.host;
  return { headers: send, authorization, signature, signedHeaders, canonicalRequest: request, stringToSign: toSign };
}

export interface PresignInput {
  method: string;
  /** "https:" or "http:" */
  protocol: string;
  host: string;
  /** Decoded path, starting with "/". */
  path: string;
  /** Extra query parameters to sign (e.g. response-content-disposition). */
  query?: readonly (readonly [string, string])[];
  credentials: SigV4Credentials;
  scope: SigV4Scope;
  date: Date;
  expiresSeconds: number;
}

/** Build a presigned URL (query-string authentication, `host` is the only signed header). */
export function presignUrl(input: PresignInput): { url: string; signature: string; canonicalRequest: string } {
  const expires = Math.min(Math.max(Math.floor(input.expiresSeconds), 1), MAX_PRESIGN_SECONDS);
  const query: [string, string][] = [
    ["X-Amz-Algorithm", SIGV4_ALGORITHM],
    ["X-Amz-Credential", `${input.credentials.accessKeyId}/${credentialScope(input.date, input.scope)}`],
    ["X-Amz-Date", amzDateTime(input.date)],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  if (input.credentials.sessionToken) query.push(["X-Amz-Security-Token", input.credentials.sessionToken]);
  for (const [k, v] of input.query ?? []) query.push([k, v]);

  const { request } = canonicalRequest({ method: input.method, path: input.path, query, headers: { host: input.host }, payloadHash: UNSIGNED_PAYLOAD });
  const toSign = stringToSign(input.date, input.scope, request);
  const signature = createHmac("sha256", deriveSigningKey(input.credentials.secretAccessKey, input.date, input.scope)).update(toSign, "utf8").digest("hex");
  const qs = `${canonicalQueryString(query)}&X-Amz-Signature=${signature}`;
  return { url: `${input.protocol}//${input.host}${awsUriEncode(input.path || "/", false)}?${qs}`, signature, canonicalRequest: request };
}

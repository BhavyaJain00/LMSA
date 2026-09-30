/**
 * An in-memory S3-compatible service on 127.0.0.1 (path-style URLs) for
 * exercising the hand-written client in `src/lib/storage/s3.ts` over real
 * HTTP.
 *
 * Every request must carry a valid SigV4 signature: the server recomputes it
 * from what actually arrived on the wire (method, raw path, raw query, the
 * signed headers and the body hash), so a client that signs one thing and
 * sends another is rejected with `SignatureDoesNotMatch`, the way S3 does.
 * Presigned GET URLs are checked the same way, including their expiry.
 *
 * Implemented: PutObject, GetObject (single ranges), HeadObject,
 * DeleteObject, DeleteObjects, ListObjectsV2 (paginated) and multipart
 * uploads (parts below 5 MiB are refused unless they are the last one).
 */
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { presignUrl, sha256Hex, signRequest } from "@/lib/storage/sigv4";

export interface FakeS3Object {
  bytes: Buffer;
  contentType: string;
  cacheControl?: string;
  etag: string;
  lastModified: Date;
}

export interface FakeS3Request {
  method: string;
  /** Decoded path, e.g. "/bucket/videos/a b.mp4". */
  path: string;
  /** Raw path as sent. */
  rawPath: string;
  query: [string, string][];
  headers: http.IncomingHttpHeaders;
  bodyLength: number;
}

export interface FakeS3Fault {
  status: number;
  code?: string;
  message?: string;
  headers?: Record<string, string>;
  /** Handle the request normally first (the client only loses the answer). */
  afterHandling?: boolean;
  /** Drop the connection without answering. */
  destroy?: boolean;
}

export interface FakeS3Options {
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Region requests must be signed for (any region is accepted when unset). */
  region?: string;
  /** Objects per ListObjectsV2 page. */
  pageSize?: number;
  /** Answer DeleteObjects with 501 NotImplemented. */
  multiDelete?: boolean;
  /** The service's clock (signatures more than 15 minutes away are refused). */
  clock?: () => Date;
}

export interface FakeS3Server {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  objects: Map<string, FakeS3Object>;
  /** Multipart uploads in progress: upload id → key and parts. */
  uploads: Map<string, { key: string; contentType: string; cacheControl?: string; parts: Map<number, Buffer> }>;
  requests: FakeS3Request[];
  /** Called for every request; a returned fault replaces (or follows) normal handling. */
  fault: ((req: FakeS3Request) => FakeS3Fault | null | undefined) | null;
  /** Requests seen with `method` (and, when given, a query parameter named `param`). */
  count(method: string, param?: string): number;
  close(): Promise<void>;
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body?: Buffer;
}

const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_SKEW_MS = 15 * 60_000;

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlUnescape(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function errorXml(code: string, message: string, extra = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message>${extra}</Error>`;
}

function parseAmzDate(value: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : null;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function startFakeS3(options: FakeS3Options = {}): Promise<FakeS3Server> {
  const bucket = options.bucket ?? "lms-media";
  const accessKeyId = options.accessKeyId ?? "AKIAFAKEFAKEFAKE0001";
  const secretAccessKey = options.secretAccessKey ?? "fake/secret+key/0123456789abcdefABCDEF";
  const clock = options.clock ?? (() => new Date());
  const objects = new Map<string, FakeS3Object>();
  const uploads: FakeS3Server["uploads"] = new Map();
  const requests: FakeS3Request[] = [];
  let uploadCounter = 0;

  const state: FakeS3Server = {
    endpoint: "",
    bucket,
    accessKeyId,
    secretAccessKey,
    objects,
    uploads,
    requests,
    fault: null,
    count: (method, param) => requests.filter((r) => r.method === method && (param === undefined || r.query.some(([k]) => k === param))).length,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };

  /** Null when the request is correctly signed, else the error to answer with. */
  function authorize(req: http.IncomingMessage, info: FakeS3Request, body: Buffer): { status: number; code: string; message: string; extra?: string } | null {
    const host = req.headers.host ?? "";
    const presigned = info.query.find(([k]) => k === "X-Amz-Signature");
    if (presigned) {
      const get = (name: string) => info.query.find(([k]) => k === name)?.[1] ?? "";
      const date = parseAmzDate(get("X-Amz-Date"));
      const credential = get("X-Amz-Credential").split("/");
      if (!date || credential.length !== 5 || get("X-Amz-SignedHeaders") !== "host") return { status: 403, code: "AccessDenied", message: "Malformed presigned URL." };
      if (credential[0] !== accessKeyId) return { status: 403, code: "InvalidAccessKeyId", message: "Unknown access key." };
      const expires = Number(get("X-Amz-Expires"));
      if (clock().getTime() > date.getTime() + expires * 1000) return { status: 403, code: "AccessDenied", message: "Request has expired" };
      const reserved = new Set(["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders", "X-Amz-Signature", "X-Amz-Security-Token"]);
      const expected = presignUrl({
        method: info.method,
        protocol: "http:",
        host,
        path: info.path,
        query: info.query.filter(([k]) => !reserved.has(k)),
        credentials: { accessKeyId, secretAccessKey },
        scope: { region: credential[2]!, service: "s3" },
        date,
        expiresSeconds: expires,
      }).signature;
      return expected === presigned[1] ? null : { status: 403, code: "SignatureDoesNotMatch", message: "The presigned signature does not match." };
    }

    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(req.headers.authorization ?? "");
    if (!m) return { status: 403, code: "AccessDenied", message: "Missing or malformed Authorization header." };
    if (m[1] !== accessKeyId) return { status: 403, code: "InvalidAccessKeyId", message: "Unknown access key." };
    if (options.region && m[3] !== options.region) {
      return { status: 400, code: "AuthorizationHeaderMalformed", message: `The region '${m[3]}' is wrong; expecting '${options.region}'`, extra: `<Region>${options.region}</Region>` };
    }
    const date = parseAmzDate(String(req.headers["x-amz-date"] ?? ""));
    if (!date) return { status: 403, code: "AccessDenied", message: "Missing x-amz-date." };
    if (Math.abs(clock().getTime() - date.getTime()) > MAX_SKEW_MS) {
      return { status: 403, code: "RequestTimeTooSkewed", message: "The difference between the request time and the current time is too large." };
    }
    const declared = String(req.headers["x-amz-content-sha256"] ?? "");
    if (declared !== sha256Hex(body)) return { status: 400, code: "XAmzContentSHA256Mismatch", message: "The provided 'x-amz-content-sha256' header does not match what was computed." };
    const signedNames = m[4]!.split(";");
    if (!signedNames.includes("host") || !signedNames.includes("x-amz-date") || !signedNames.includes("x-amz-content-sha256")) {
      return { status: 403, code: "AccessDenied", message: "host, x-amz-date and x-amz-content-sha256 must be signed." };
    }
    const headers: Record<string, string> = {};
    for (const name of signedNames) {
      if (name === "host" || name === "x-amz-date") continue;
      const value = req.headers[name];
      headers[name] = Array.isArray(value) ? value.join(",") : (value ?? "");
    }
    const expected = signRequest({
      method: info.method,
      host,
      path: info.path,
      query: info.query,
      headers,
      payloadHash: declared,
      credentials: { accessKeyId, secretAccessKey },
      scope: { region: m[3]!, service: "s3" },
      date,
    });
    if (expected.signedHeaders !== m[4] || expected.signature !== m[5]) {
      return { status: 403, code: "SignatureDoesNotMatch", message: "The request signature we calculated does not match the signature you provided." };
    }
    return null;
  }

  function reply(status: number, headers: Record<string, string>, body?: Buffer | string): Reply {
    return { status, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8") };
  }

  function errorReply(method: string, status: number, code: string, message: string, extra = "", headers: Record<string, string> = {}): Reply {
    return method === "HEAD" ? reply(status, headers) : reply(status, { "Content-Type": "application/xml", ...headers }, errorXml(code, message, extra));
  }

  function write(res: http.ServerResponse, r: Reply): void {
    res.writeHead(r.status, { Date: clock().toUTCString(), ...r.headers, ...(r.body && !("Content-Length" in r.headers) ? { "Content-Length": String(r.body.byteLength) } : {}) });
    res.end(r.body);
  }

  function objectHeaders(object: FakeS3Object): Record<string, string> {
    return {
      "Content-Type": object.contentType,
      ETag: object.etag,
      "Last-Modified": object.lastModified.toUTCString(),
      "Accept-Ranges": "bytes",
      ...(object.cacheControl ? { "Cache-Control": object.cacheControl } : {}),
    };
  }

  function store(key: string, bytes: Buffer, contentType: string, cacheControl: string | undefined, etag?: string): FakeS3Object {
    const object: FakeS3Object = { bytes, contentType, cacheControl, etag: etag ?? `"${createHash("md5").update(bytes).digest("hex")}"`, lastModified: new Date(Math.floor(clock().getTime() / 1000) * 1000) };
    objects.set(key, object);
    return object;
  }

  function handle(req: http.IncomingMessage, info: FakeS3Request, body: Buffer): Reply {
    const method = info.method;
    const param = (name: string) => info.query.find(([k]) => k === name)?.[1];
    const has = (name: string) => info.query.some(([k]) => k === name);
    const prefix = `/${bucket}`;
    if (info.path !== prefix && !info.path.startsWith(`${prefix}/`)) return errorReply(method, 404, "NoSuchBucket", "The specified bucket does not exist");
    const key = info.path.slice(prefix.length + 1);

    if (!key) {
      if (method === "GET" && param("list-type") === "2") {
        const wanted = param("prefix") ?? "";
        const pageSize = options.pageSize ?? 1000;
        const all = [...objects.keys()].filter((k) => k.startsWith(wanted)).sort();
        const start = Number(param("continuation-token") ?? 0);
        const page = all.slice(start, start + pageSize);
        const truncated = start + pageSize < all.length;
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult><Name>${bucket}</Name><Prefix>${xmlEscape(wanted)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${pageSize}</MaxKeys>` +
          `<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>` : ""}` +
          page.map((k) => `<Contents><Key>${xmlEscape(k)}</Key><Size>${objects.get(k)!.bytes.byteLength}</Size></Contents>`).join("") +
          "</ListBucketResult>";
        return reply(200, { "Content-Type": "application/xml" }, xml);
      }
      if (method === "POST" && has("delete")) {
        if (options.multiDelete === false) return errorReply(method, 501, "NotImplemented", "A header you provided implies functionality that is not implemented");
        if (req.headers["content-md5"] !== createHash("md5").update(body).digest("base64")) return errorReply(method, 400, "BadDigest", "The Content-MD5 you specified did not match what we received.");
        const keys = [...body.toString("utf8").matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => xmlUnescape(m[1]!));
        const errors = keys
          .filter((k) => k.includes("locked"))
          .map((k) => `<Error><Key>${xmlEscape(k)}</Key><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`);
        for (const k of keys) if (!k.includes("locked")) objects.delete(k);
        return reply(200, { "Content-Type": "application/xml" }, `<?xml version="1.0" encoding="UTF-8"?>\n<DeleteResult>${errors.join("")}</DeleteResult>`);
      }
      return errorReply(method, 400, "InvalidRequest", "Unsupported bucket operation");
    }

    const uploadId = param("uploadId");
    if (method === "POST" && has("uploads")) {
      const id = `upload-${++uploadCounter}/with+odd=chars`;
      uploads.set(id, { key, contentType: String(req.headers["content-type"] ?? "binary/octet-stream"), cacheControl: req.headers["cache-control"], parts: new Map() });
      return reply(200, { "Content-Type": "application/xml" }, `<?xml version="1.0" encoding="UTF-8"?>\n<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${xmlEscape(key)}</Key><UploadId>${xmlEscape(id)}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (uploadId !== undefined) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.key !== key) return errorReply(method, 404, "NoSuchUpload", "The specified upload does not exist.");
      if (method === "PUT") {
        const partNumber = Number(param("partNumber"));
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return errorReply(method, 400, "InvalidArgument", "Part number must be an integer between 1 and 10000");
        upload.parts.set(partNumber, body);
        return reply(200, { ETag: `"${createHash("md5").update(body).digest("hex")}"` });
      }
      if (method === "DELETE") {
        uploads.delete(uploadId);
        return reply(204, {});
      }
      if (method === "POST") {
        const listed = [...body.toString("utf8").matchAll(/<Part><PartNumber>(\d+)<\/PartNumber><ETag>([\s\S]*?)<\/ETag><\/Part>/g)].map((m) => ({ n: Number(m[1]), etag: xmlUnescape(m[2]!) }));
        const buffers: Buffer[] = [];
        for (const [i, part] of listed.entries()) {
          const bytes = upload.parts.get(part.n);
          if (!bytes || `"${createHash("md5").update(bytes).digest("hex")}"` !== part.etag) return errorReply(method, 400, "InvalidPart", "One or more of the specified parts could not be found.");
          if (i > 0 && part.n <= listed[i - 1]!.n) return errorReply(method, 400, "InvalidPartOrder", "The list of parts was not in ascending order.");
          if (i < listed.length - 1 && bytes.byteLength < MIN_PART_SIZE) return errorReply(method, 400, "EntityTooSmall", "Your proposed upload is smaller than the minimum allowed size");
          buffers.push(bytes);
        }
        if (!listed.length) return errorReply(method, 400, "MalformedXML", "The XML you provided was not well-formed");
        const object = store(key, Buffer.concat(buffers), upload.contentType, upload.cacheControl, `"multipart-${listed.length}"`);
        uploads.delete(uploadId);
        return reply(200, { "Content-Type": "application/xml" }, `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${xmlEscape(key)}</Key><ETag>${xmlEscape(object.etag)}</ETag></CompleteMultipartUploadResult>`);
      }
    }

    if (method === "PUT") {
      const object = store(key, body, String(req.headers["content-type"] ?? "binary/octet-stream"), req.headers["cache-control"]);
      return reply(200, { ETag: object.etag });
    }
    if (method === "DELETE") {
      objects.delete(key);
      return reply(204, {});
    }
    if (method === "GET" || method === "HEAD") {
      const object = objects.get(key);
      if (!object) return errorReply(method, 404, "NoSuchKey", "The specified key does not exist.");
      const headers = objectHeaders(object);
      const overrideType = param("response-content-type");
      if (overrideType) headers["Content-Type"] = overrideType;
      const size = object.bytes.byteLength;
      if (method === "HEAD") return reply(200, { ...headers, "Content-Length": String(size) });
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) return errorReply(method, 416, "InvalidRange", "The requested range is not satisfiable", "", { "Content-Range": `bytes */${size}` });
        return reply(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` }, object.bytes.subarray(start, end + 1));
      }
      return reply(200, headers, object.bytes);
    }
    return errorReply(method, 405, "MethodNotAllowed", "The specified method is not allowed against this resource.");
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const [rawPath = "/", rawQuery = ""] = (req.url ?? "/").split("?") as [string, string?];
      const info: FakeS3Request = {
        method: req.method ?? "GET",
        rawPath,
        path: rawPath.split("/").map(decodeURIComponent).join("/"),
        query: rawQuery
          ? rawQuery.split("&").map((pair): [string, string] => {
              const i = pair.indexOf("=");
              return i === -1 ? [decodeURIComponent(pair), ""] : [decodeURIComponent(pair.slice(0, i)), decodeURIComponent(pair.slice(i + 1))];
            })
          : [],
        headers: req.headers,
        bodyLength: body.byteLength,
      };
      requests.push(info);
      const denied = authorize(req, info, body);
      if (denied) return write(res, errorReply(info.method, denied.status, denied.code, denied.message, denied.extra));

      const fault = state.fault?.(info);
      if (fault?.destroy) {
        res.destroy();
        return;
      }
      // With `afterHandling` the work is done and only the answer is replaced (a lost response).
      const handled = fault && !fault.afterHandling ? null : handle(req, info, body);
      if (fault) return write(res, errorReply(info.method, fault.status, fault.code ?? "InternalError", fault.message ?? "We encountered an internal error. Please try again.", "", fault.headers));
      write(res, handled!);
    })().catch((err) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(err));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}

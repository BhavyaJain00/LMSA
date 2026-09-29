import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MultipartError, multipartBoundary, parseContentDisposition, parseMultipart, type MultipartPart } from "@/lib/media/multipart";
import { MULTIPART_OVERHEAD_BYTES, receiveUpload, type UploadConfig } from "@/lib/media/upload";
import { readLimitedText } from "@/lib/media/body";

/** Secure-video review, finding 2: uploads and heartbeats must not buffer unbounded bodies. */

const BOUNDARY = "----llTestBoundary7MA4YWxkTrZu0gW";
const MB = 1024 * 1024;
const enc = new TextEncoder();

interface FormPart {
  name: string;
  filename?: string;
  type?: string;
  data: Uint8Array | string;
}

function multipartBody(parts: FormPart[], boundary = BOUNDARY): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) head += `; filename="${part.filename}"`;
    head += "\r\n";
    if (part.type) head += `Content-Type: ${part.type}\r\n`;
    head += "\r\n";
    chunks.push(enc.encode(head), typeof part.data === "string" ? enc.encode(part.data) : part.data, enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** A stream that delivers `bytes` in pieces of `size` and records how much was pulled. */
function chunkedStream(bytes: Uint8Array, size: number, stats = { pulled: 0 }): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const piece = bytes.slice(offset, offset + size);
      offset += piece.byteLength;
      stats.pulled += piece.byteLength;
      controller.enqueue(piece);
    },
  }, { highWaterMark: 0 });
}

function uploadRequest(body: Uint8Array, opts: { contentLength?: string | null; chunk?: number; boundary?: string; stats?: { pulled: number } } = {}): Request {
  const headers = new Headers({ "Content-Type": `multipart/form-data; boundary=${opts.boundary ?? BOUNDARY}` });
  const length = opts.contentLength === undefined ? String(body.byteLength) : opts.contentLength;
  if (length !== null) headers.set("Content-Length", length);
  return new Request("http://localhost:3000/api/upload", { method: "POST", headers, body: chunkedStream(body, opts.chunk ?? 64 * 1024, opts.stats), duplex: "half" } as RequestInit);
}

const MP4_HEAD = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
function fakeVideo(size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(MP4_HEAD);
  for (let i = MP4_HEAD.length; i < size; i++) out[i] = (i * 31) & 0xff;
  return out;
}

let root: string;
const config = (overrides: Partial<UploadConfig> = {}): UploadConfig => ({ root, staff: true, maxVideoBytes: 8 * MB, maxAssetBytes: 1 * MB, ...overrides });
const leftovers = () => [...readdirSync(root), ...(existsSync(path.join(root, "videos")) ? readdirSync(path.join(root, "videos")) : [])].filter((n) => n.endsWith(".part"));

before(() => {
  root = path.join(mkdtempSync(path.join(tmpdir(), "ll-sv-upload-")), "uploads");
});
after(() => rmSync(path.dirname(root), { recursive: true, force: true }));

describe("multipart parser", () => {
  const collect = async (body: Uint8Array, chunk: number, boundary = BOUNDARY) => {
    const parts: { part: MultipartPart; data: string }[] = [];
    await parseMultipart(chunkedStream(body, chunk), boundary, (part) => {
      const pieces: Uint8Array[] = [];
      return {
        write: (c) => void pieces.push(c.slice()),
        end: () => void parts.push({ part, data: Buffer.concat(pieces).toString("utf8") }),
      };
    });
    return parts;
  };

  it("parses fields and files at every chunk size (boundaries split across chunks)", async () => {
    const body = multipartBody([
      { name: "file", filename: "fakepath/v1.txt", type: "text/plain", data: "line one\r\n--not-a-boundary\r\nline three" },
      { name: "kind", data: "document" },
    ]);
    for (const size of [1, 2, 3, 7, 16, 41, 64, 1000, body.byteLength]) {
      const parts = await collect(body, size);
      assert.equal(parts.length, 2, `chunk ${size}`);
      assert.equal(parts[0]!.part.name, "file");
      assert.equal(parts[0]!.part.filename, "v1.txt");
      assert.equal(parts[0]!.part.contentType, "text/plain");
      assert.equal(parts[0]!.data, "line one\r\n--not-a-boundary\r\nline three");
      assert.deepEqual([parts[1]!.part.name, parts[1]!.part.filename, parts[1]!.data], ["kind", null, "document"]);
    }
  });

  it("reads boundaries and dispositions like browsers send them", () => {
    assert.equal(multipartBoundary(`multipart/form-data; boundary=${BOUNDARY}`), BOUNDARY);
    assert.equal(multipartBoundary('multipart/form-data; charset=utf-8; boundary="a b:c"'), "a b:c");
    assert.equal(multipartBoundary("application/json"), null);
    assert.equal(multipartBoundary("multipart/form-data"), null);
    assert.equal(multipartBoundary(`multipart/form-data; boundary=${"x".repeat(71)}`), null);
    const { params } = parseContentDisposition('form-data; name="file"; filename="a%22b%0A.mp4"; filename*=UTF-8\'\'%C3%BCber.mp4');
    assert.deepEqual(params, { name: "file", filename: "über.mp4" });
    assert.equal(parseContentDisposition('form-data; name="f"; filename="say \\"hi\\".txt"').params.filename, 'say "hi".txt');
  });

  it("rejects truncated bodies, missing boundaries, oversized headers and too many parts", async () => {
    const good = multipartBody([{ name: "kind", data: "video" }]);
    await assert.rejects(collect(good.slice(0, good.byteLength - 8), 5), (e: unknown) => e instanceof MultipartError && e.code === "truncated");
    await assert.rejects(collect(enc.encode("x".repeat(5000)), 100), (e: unknown) => e instanceof MultipartError && e.code === "malformed");
    const hugeHeader = enc.encode(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\nX-Pad: ${"p".repeat(20_000)}\r\n\r\nv\r\n--${BOUNDARY}--`);
    await assert.rejects(collect(hugeHeader, 512), (e: unknown) => e instanceof MultipartError && e.code === "header-too-large");
    const many = multipartBody(Array.from({ length: 40 }, (_, i) => ({ name: `f${i}`, data: "x" })));
    await assert.rejects(collect(many, 256), (e: unknown) => e instanceof MultipartError && e.code === "too-many-parts");
  });
});

describe("receiveUpload", () => {
  it("streams a video to /uploads/videos/ without leaving temporary files", async () => {
    const video = fakeVideo(3 * MB + 123);
    const body = multipartBody([
      { name: "file", filename: "Intro Clip.MP4", type: "video/mp4", data: video },
      { name: "kind", data: "video" },
    ]);
    const res = await receiveUpload(uploadRequest(body, { chunk: 60_000 }), config());
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    if (!res.body.ok) return;
    assert.match(res.body.url, /^\/uploads\/videos\/intro-clip-[a-z0-9]{16}\.mp4$/);
    assert.deepEqual([res.body.name, res.body.size, res.body.type], ["Intro Clip.MP4", video.byteLength, "video/mp4"]);
    const stored = readFileSync(path.join(root, "videos", path.basename(res.body.url)));
    assert.equal(Buffer.compare(stored, Buffer.from(video)), 0);
    assert.deepEqual(leftovers(), []);
  });

  it("rejects a body larger than the role limit before reading any of it", async () => {
    const stats = { pulled: 0 };
    const body = multipartBody([{ name: "file", filename: "a.pdf", type: "application/pdf", data: "%PDF" }]);
    const student = await receiveUpload(uploadRequest(body, { contentLength: String(1 * MB + MULTIPART_OVERHEAD_BYTES + 1), stats }), config({ staff: false }));
    assert.equal(student.status, 413);
    const staff = await receiveUpload(uploadRequest(body, { contentLength: String(8 * MB + MULTIPART_OVERHEAD_BYTES + 1), stats }), config());
    assert.equal(staff.status, 413);
    assert.equal(stats.pulled, 0);
    assert.equal((await receiveUpload(uploadRequest(body, { contentLength: null }), config())).status, 411);
    assert.equal((await receiveUpload(uploadRequest(body, { contentLength: "12abc" }), config())).status, 400);
  });

  it("enforces the per-type limit while streaming and deletes the partial file", async () => {
    // Staff may send up to the video limit, but a document may not exceed the asset limit.
    const doc = new Uint8Array(1 * MB + 10).fill(65);
    const body = multipartBody([{ name: "file", filename: "big.pdf", type: "application/pdf", data: doc }]);
    // A lying Content-Length (smaller than the body) still cannot get more than the limit written.
    const res = await receiveUpload(uploadRequest(body, { contentLength: String(1 * MB), chunk: 32 * 1024 }), config());
    assert.equal(res.status, 413);
    assert.deepEqual(leftovers(), []);
    // With an honest Content-Length a file that cannot fit is refused as soon as its headers arrive.
    const huge = multipartBody([{ name: "file", filename: "huge.pdf", type: "application/pdf", data: new Uint8Array(3 * MB).fill(66) }]);
    const early = await receiveUpload(uploadRequest(huge), config());
    assert.equal(early.status, 413);
    assert.equal(early.body.ok ? "" : early.body.error, "File is too large (max 1 MB).");
    assert.deepEqual(leftovers(), []);
  });

  it("checks roles, types and content before keeping a file", async () => {
    const video = multipartBody([{ name: "file", filename: "v.mp4", type: "video/mp4", data: fakeVideo(4096) }]);
    assert.equal((await receiveUpload(uploadRequest(video), config({ staff: false }))).status, 403);
    const fakeMp4 = multipartBody([{ name: "file", filename: "v.mp4", type: "video/mp4", data: "definitely not a video container at all" }]);
    assert.equal((await receiveUpload(uploadRequest(fakeMp4, { chunk: 5 }), config())).status, 415);
    const exe = multipartBody([{ name: "file", filename: "x.exe", type: "application/x-msdownload", data: "MZ" }]);
    assert.equal((await receiveUpload(uploadRequest(exe), config())).status, 415);
    const wrongKind = multipartBody([
      { name: "file", filename: "doc.pdf", type: "application/pdf", data: "%PDF-1.7" },
      { name: "kind", data: "image" },
    ]);
    assert.equal((await receiveUpload(uploadRequest(wrongKind), config())).status, 415);
    const empty = multipartBody([{ name: "file", filename: "e.txt", type: "text/plain", data: "" }]);
    assert.equal((await receiveUpload(uploadRequest(empty), config())).status, 400);
    const none = multipartBody([{ name: "kind", data: "image" }]);
    assert.equal((await receiveUpload(uploadRequest(none), config())).status, 400);
    const two = multipartBody([
      { name: "file", filename: "a.txt", type: "text/plain", data: "a" },
      { name: "file", filename: "b.txt", type: "text/plain", data: "b" },
    ]);
    assert.equal((await receiveUpload(uploadRequest(two), config())).status, 400);
    assert.equal((await receiveUpload(uploadRequest(enc.encode("garbage"), { boundary: BOUNDARY }), config())).status, 400);
    assert.deepEqual(leftovers(), []);
  });

  it("stores student documents at the upload root", async () => {
    const body = multipartBody([
      { name: "file", filename: "Essay (final).pdf", type: "application/pdf", data: "%PDF-1.7 essay" },
      { name: "kind", data: "document" },
    ]);
    const res = await receiveUpload(uploadRequest(body, { chunk: 3 }), config({ staff: false }));
    assert.equal(res.status, 200);
    assert.equal(res.body.ok && /^\/uploads\/essay-final-[a-z0-9]{16}\.pdf$/.test(res.body.url), true);
  });
});

describe("readLimitedText", () => {
  const request = (body: string, contentLength?: string | null) => {
    const headers = new Headers();
    if (contentLength !== null) headers.set("Content-Length", contentLength ?? String(enc.encode(body).byteLength));
    return new Request("http://localhost:3000/api/video-progress", { method: "POST", headers, body: chunkedStream(enc.encode(body), 1000), duplex: "half" } as RequestInit);
  };

  it("reads small bodies and refuses large ones without buffering them", async () => {
    assert.deepEqual(await readLimitedText(request('{"a":1}'), 16 * 1024), { ok: true, text: '{"a":1}' });
    assert.deepEqual(await readLimitedText(request("x".repeat(100), String(10 * 1024 * 1024)), 16 * 1024), { ok: false, status: 413 });
    // No (or a lying) Content-Length: the stream is cut off after the cap.
    assert.deepEqual(await readLimitedText(request("x".repeat(40 * 1024), null), 16 * 1024), { ok: false, status: 413 });
    assert.deepEqual(await readLimitedText(request("x".repeat(40 * 1024), "10"), 16 * 1024), { ok: false, status: 413 });
    assert.deepEqual(await readLimitedText(request("{}", "-1"), 16 * 1024), { ok: false, status: 400 });
  });
});

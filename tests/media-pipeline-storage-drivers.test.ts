import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { storageEnv } from "@/lib/server-env";
import {
  cacheControlForKey,
  getStorage,
  getStorageStatus,
  isRemoteStorage,
  localStorage,
  localUsage,
  migrateLocalToRemote,
  offloadLocalFile,
  publicBaseUrl,
  s3Client,
  storageFor,
  testStorageConnection,
  uploadRoot,
} from "@/lib/storage";
import { isSafeStorageKey, isSafeStoragePrefix, keyDirectory, storageKeyFromUrl, uploadUrlForKey } from "@/lib/storage/keys";
import { LocalStorage } from "@/lib/storage/local";
import { parseByteRange } from "@/lib/storage/range";
import { MULTIPART_THRESHOLD, S3Storage, multipartPartSize } from "@/lib/storage/remote";
import { S3Client, S3Error } from "@/lib/storage/s3";
import type { ReadResult, StorageDriver } from "@/lib/storage/types";
import { startFakeS3, type FakeS3Server } from "./helpers/fake-s3";

/** The two storage drivers behind one contract, and the driver selection in `@/lib/storage`. */

const MIB = 1024 * 1024;
const work = mkdtempSync(path.join(tmpdir(), "ll-storage-"));
after(() => rmSync(work, { recursive: true, force: true }));

function tempFile(name: string, bytes: Uint8Array): string {
  const file = path.join(work, name);
  writeFileSync(file, bytes);
  return file;
}

async function bytesOf(result: ReadResult | "unsatisfiable" | null): Promise<Buffer> {
  assert.ok(result && result !== "unsatisfiable", "the object is readable");
  return Buffer.from(await new Response(result.body).arrayBuffer());
}

const UNSAFE_KEYS = ["", "/a.txt", "a.txt/", "../a.txt", "a/../b.txt", "a//b.txt", ".hidden/a.txt", "a/.part", "a\\b.txt", "videos/a.mp4:stream", "con/a.txt", "a/b. ", "a/b.txt."];

describe("storage keys", () => {
  it("accepts generated upload names and rejects anything that could escape or alias", () => {
    for (const key of ["logo-abc.png", "videos/intro-abc.mp4", "videos/les_1/blk_2/hls/v1/720p/seg_00001.m4s", "docs/My File (1).pdf"]) assert.equal(isSafeStorageKey(key), true, key);
    for (const key of UNSAFE_KEYS) assert.equal(isSafeStorageKey(key), false, JSON.stringify(key));
    assert.equal(isSafeStorageKey(`${"a/".repeat(32)}b`), false, "too deep");
    assert.equal(isSafeStorageKey(Array.from({ length: 12 }, () => "a".repeat(100)).join("/")), false, "too long");
  });

  it("prefixes are safe keys followed by a slash", () => {
    assert.equal(isSafeStoragePrefix("videos/les_1/blk_2/hls/v1/"), true);
    assert.equal(isSafeStoragePrefix("videos/les_1"), false);
    assert.equal(isSafeStoragePrefix("/"), false);
    assert.equal(isSafeStoragePrefix(""), false);
    assert.equal(isSafeStoragePrefix("../"), false);
  });

  it("maps keys to /uploads URLs and back", () => {
    assert.equal(uploadUrlForKey("videos/my clip.mp4"), "/uploads/videos/my%20clip.mp4");
    assert.equal(storageKeyFromUrl("/uploads/videos/my%20clip.mp4"), "videos/my clip.mp4");
    assert.equal(storageKeyFromUrl("/uploads/videos/a.mp4?t=1999999999.abc"), "videos/a.mp4");
    assert.equal(storageKeyFromUrl("http://localhost:3000/uploads/logo.png", ["http://localhost:3000"]), "logo.png");
    assert.equal(storageKeyFromUrl("https://elsewhere.example/uploads/logo.png", ["http://localhost:3000"]), null);
    assert.equal(storageKeyFromUrl("/images/logo.png"), null);
    assert.equal(storageKeyFromUrl("/uploads/../storage/db.json"), null);
    assert.equal(storageKeyFromUrl(undefined), null);
    assert.equal(keyDirectory("videos/a/b.mp4"), "videos/a/");
    assert.equal(keyDirectory("logo.png"), "");
  });
});

describe("byte ranges", () => {
  it("parses single ranges against the file size", () => {
    assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
    assert.deepEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999 });
    assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
    assert.deepEqual(parseByteRange("bytes=-5000", 1000), { start: 0, end: 999 });
    assert.deepEqual(parseByteRange("bytes=990-2000", 1000), { start: 990, end: 999 });
    assert.deepEqual(parseByteRange(" bytes=1-1 ", 1000), { start: 1, end: 1 });
  });

  it("flags unsatisfiable ranges and ignores unsupported ones", () => {
    assert.equal(parseByteRange("bytes=1000-", 1000), "invalid");
    assert.equal(parseByteRange("bytes=5-2", 1000), "invalid");
    assert.equal(parseByteRange("bytes=-0", 1000), "invalid");
    assert.equal(parseByteRange("bytes=0-", 0), "invalid");
    assert.equal(parseByteRange("bytes=99999999999999999999-", 1000), "invalid");
    assert.equal(parseByteRange(null, 1000), null);
    assert.equal(parseByteRange("", 1000), null);
    assert.equal(parseByteRange("bytes=-", 1000), null);
    assert.equal(parseByteRange("bytes=0-1,5-6", 1000), null, "multi-range requests get the whole file");
    assert.equal(parseByteRange("items=0-1", 1000), null);
  });
});

describe("multipart part size", () => {
  it("is 16 MiB until the part limit forces larger whole-MiB parts", () => {
    assert.equal(multipartPartSize(17 * MIB), 16 * MIB);
    assert.equal(multipartPartSize(5 * 1024 * MIB), 16 * MIB);
    assert.equal(multipartPartSize(9_000 * 16 * MIB), 16 * MIB);
    const huge = 500 * 1024 * MIB;
    const part = multipartPartSize(huge);
    assert.equal(part % MIB, 0);
    assert.ok(part > 16 * MIB && Math.ceil(huge / part) <= 9_000);
  });
});

/** Behaviour both drivers share. */
function contract(name: string, make: () => StorageDriver) {
  describe(`${name} driver contract`, () => {
    let driver: StorageDriver;
    before(() => {
      driver = make();
    });

    it("stores, describes, reads and deletes bytes", async () => {
      const key = "contract/hello.txt";
      assert.equal(await driver.head(key), null);
      assert.equal(await driver.read(key), null);
      assert.equal(await driver.readText(key, 100), null);
      await driver.putBytes(key, Buffer.from("hello storage"), { contentType: "text/plain; charset=utf-8" });
      const info = await driver.head(key);
      assert.equal(info!.size, 13);
      assert.ok(info!.lastModified instanceof Date);
      const whole = await driver.read(key);
      assert.ok(whole && whole !== "unsatisfiable");
      assert.equal(whole.status, 200);
      assert.equal(whole.length, 13);
      assert.equal(whole.size, 13);
      assert.equal(whole.contentRange, undefined);
      assert.equal((await bytesOf(whole)).toString(), "hello storage");
      await driver.putBytes(key, Buffer.from("replaced"), { contentType: "text/plain; charset=utf-8" });
      assert.equal(await driver.readText(key, 100), "replaced");
      await driver.delete(key);
      assert.equal(await driver.head(key), null);
      await driver.delete(key);
    });

    it("serves single byte ranges", async () => {
      const key = "contract/range.bin";
      await driver.putBytes(key, Buffer.from("0123456789"), { contentType: "application/octet-stream" });
      const middle = await driver.read(key, "bytes=2-5");
      assert.ok(middle && middle !== "unsatisfiable");
      assert.deepEqual([middle.status, middle.length, middle.size, middle.contentRange], [206, 4, 10, "bytes 2-5/10"]);
      assert.equal((await bytesOf(middle)).toString(), "2345");
      assert.equal((await bytesOf(await driver.read(key, "bytes=-3"))).toString(), "789");
      assert.equal((await bytesOf(await driver.read(key, "bytes=8-"))).toString(), "89");
      assert.equal((await bytesOf(await driver.read(key, "bytes=8-500"))).toString(), "89");
      assert.equal(await driver.read(key, "bytes=10-"), "unsatisfiable");
      for (const ignored of ["bytes=0-1,4-5", "bytes=-", "lines=1-2", null]) {
        const whole = await driver.read(key, ignored);
        assert.ok(whole && whole !== "unsatisfiable");
        assert.equal(whole.status, 200, String(ignored));
        assert.equal((await bytesOf(whole)).toString(), "0123456789");
      }
    });

    it("reads text only up to the size limit", async () => {
      const key = "contract/playlist.m3u8";
      await driver.putBytes(key, Buffer.from("#EXTM3U\n#EXT-X-VERSION:7\n"), { contentType: "application/vnd.apple.mpegurl" });
      assert.equal(await driver.readText(key, 1024), "#EXTM3U\n#EXT-X-VERSION:7\n");
      assert.equal(await driver.readText(key, 25), "#EXTM3U\n#EXT-X-VERSION:7\n");
      assert.equal(await driver.readText(key, 24), null);
    });

    it("stores a file from disk, copying or moving it", async () => {
      const bytes = randomBytes(70_000);
      const copied = tempFile(`${name}-copy.bin`, bytes);
      const progress: number[] = [];
      await driver.putFile("contract/files/copy.bin", copied, { contentType: "application/octet-stream", onProgress: (n) => progress.push(n) });
      assert.ok(existsSync(copied), "the source stays without move");
      assert.deepEqual(progress, [70_000]);
      assert.ok((await bytesOf(await driver.read("contract/files/copy.bin"))).equals(bytes));

      const moved = tempFile(`${name}-move.bin`, bytes);
      await driver.putFile("contract/files/move.bin", moved, { contentType: "application/octet-stream", move: true });
      assert.equal(existsSync(moved), false, "the source is gone after a move");
      assert.equal((await driver.head("contract/files/move.bin"))!.size, 70_000);
    });

    it("deletes everything under a prefix and nothing else", async () => {
      for (const key of ["contract/hls/v1/master.m3u8", "contract/hls/v1/720p/seg_1.m4s", "contract/hls/v1/720p/seg_2.m4s", "contract/hls/v2/master.m3u8", "contract/hls/v10/master.m3u8"]) {
        await driver.putBytes(key, Buffer.from(key), { contentType: "application/octet-stream" });
      }
      assert.ok((await driver.deletePrefix("contract/hls/v1/")) >= 1);
      assert.equal(await driver.head("contract/hls/v1/master.m3u8"), null);
      assert.equal(await driver.head("contract/hls/v1/720p/seg_2.m4s"), null);
      assert.ok(await driver.head("contract/hls/v2/master.m3u8"));
      assert.ok(await driver.head("contract/hls/v10/master.m3u8"), "v10 is not under v1/");
      assert.equal(await driver.deletePrefix("contract/hls/v1/"), 0);
      assert.equal(await driver.deletePrefix("contract/never/"), 0);
    });

    it("refuses unsafe keys and prefixes", async () => {
      for (const key of UNSAFE_KEYS) {
        await assert.rejects(driver.putBytes(key, Buffer.from("x"), { contentType: "text/plain" }), /Unsafe storage key/, JSON.stringify(key));
        await assert.rejects(async () => driver.read(key), /Unsafe storage key/, JSON.stringify(key));
        await assert.rejects(async () => driver.delete(key), /Unsafe storage key/, JSON.stringify(key));
      }
      for (const prefix of ["", "/", "contract", "../", "contract/../", ".uploads/"]) {
        await assert.rejects(driver.deletePrefix(prefix), /Unsafe storage prefix/, JSON.stringify(prefix));
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Local driver                                                         */
/* ------------------------------------------------------------------ */

const localRoot = path.join(work, "local-root");
mkdirSync(localRoot, { recursive: true });
contract("local", () => new LocalStorage(localRoot));

describe("local driver", () => {
  const driver = new LocalStorage(localRoot);

  it("maps keys to files below its root", async () => {
    assert.equal(driver.pathOf("videos/a.mp4"), path.join(localRoot, "videos", "a.mp4"));
    await driver.putBytes("videos/a.mp4", Buffer.from("video"));
    assert.equal(readFileSync(path.join(localRoot, "videos", "a.mp4"), "utf8"), "video");
    assert.deepEqual(await driver.processingInput("videos/a.mp4"), { input: path.join(localRoot, "videos", "a.mp4"), type: "file" });
  });

  it("leaves no temporary files behind", async () => {
    const source = tempFile("local-leftover.bin", randomBytes(1000));
    await driver.putFile("tidy/a.bin", source, { contentType: "application/octet-stream" });
    await driver.putBytes("tidy/b.bin", Buffer.from("b"));
    assert.deepEqual(readdirSync(path.join(localRoot, "tidy")).sort(), ["a.bin", "b.bin"]);
  });

  it("a directory is not an object", async () => {
    await driver.putBytes("dir/inner/file.txt", Buffer.from("x"));
    assert.equal(await driver.head("dir/inner"), null);
    assert.equal(await driver.read("dir/inner"), null);
  });
});

/* ------------------------------------------------------------------ */
/* S3 driver                                                            */
/* ------------------------------------------------------------------ */

let s3: FakeS3Server;
before(async () => {
  s3 = await startFakeS3();
});
after(async () => {
  await s3.close();
});

function s3Driver(server: FakeS3Server = s3): S3Storage {
  return new S3Storage(
    new S3Client({ endpoint: server.endpoint, region: "auto", bucket: server.bucket, accessKeyId: server.accessKeyId, secretAccessKey: server.secretAccessKey, forcePathStyle: false }, { sleep: async () => undefined }),
  );
}

contract("s3", () => s3Driver());

describe("s3 driver", () => {
  beforeEach(() => {
    s3.objects.clear();
    s3.uploads.clear();
    s3.requests.length = 0;
    s3.fault = null;
  });

  it("sends small files in one request with their content type and cache policy", async () => {
    const bytes = randomBytes(200_000);
    await s3Driver().putFile("posters/p.jpg", tempFile("s3-small.jpg", bytes), { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" });
    assert.equal(s3.count("PUT"), 1);
    assert.equal(s3.count("POST"), 0);
    const stored = s3.objects.get("posters/p.jpg")!;
    assert.ok(stored.bytes.equals(bytes));
    assert.equal(stored.contentType, "image/jpeg");
    assert.equal(stored.cacheControl, "public, max-age=31536000, immutable");
  });

  it("uploads large files part by part and removes the source after a move", async () => {
    const size = 2 * MULTIPART_THRESHOLD + MIB + 123;
    const bytes = randomBytes(size);
    const source = tempFile("s3-large.mp4", bytes);
    const progress: number[] = [];
    await s3Driver().putFile("videos/large.mp4", source, { contentType: "video/mp4", cacheControl: "private, max-age=0", move: true, onProgress: (n) => progress.push(n) });

    assert.equal(s3.count("POST", "uploads"), 1);
    assert.equal(s3.count("PUT", "partNumber"), 3);
    assert.deepEqual(
      s3.requests
        .filter((r) => r.method === "PUT")
        .map((r) => r.bodyLength)
        .sort((a, b) => a - b),
      [MIB + 123, 16 * MIB, 16 * MIB],
    );
    const stored = s3.objects.get("videos/large.mp4")!;
    assert.equal(stored.bytes.byteLength, size);
    assert.equal(createHash("sha256").update(stored.bytes).digest("hex"), createHash("sha256").update(bytes).digest("hex"));
    assert.equal(stored.contentType, "video/mp4");
    assert.equal(stored.cacheControl, "private, max-age=0");
    assert.equal(s3.uploads.size, 0);
    assert.equal(progress.length, 3);
    assert.ok(progress.every((n, i) => i === 0 || n > progress[i - 1]!), "progress only grows");
    assert.equal(progress.at(-1), size);
    assert.equal(existsSync(source), false);
  });

  it("aborts the multipart upload and keeps the source when a part is refused", async () => {
    const source = tempFile("s3-refused.mp4", randomBytes(MULTIPART_THRESHOLD + 10));
    s3.fault = (req) => (req.method === "PUT" && req.query.some(([k, v]) => k === "partNumber" && v === "2") ? { status: 403, code: "AccessDenied", message: "Access Denied" } : null);
    await assert.rejects(
      s3Driver().putFile("videos/refused.mp4", source, { contentType: "video/mp4", move: true }),
      (err: unknown) => err instanceof S3Error && err.code === "AccessDenied",
    );
    assert.equal(s3.uploads.size, 0, "no orphaned parts are left in the bucket");
    assert.equal(s3.count("DELETE", "uploadId"), 1);
    assert.equal(s3.objects.has("videos/refused.mp4"), false);
    assert.ok(existsSync(source), "the local file stays for another try");
  });

  it("stops when the caller aborts", async () => {
    const source = tempFile("s3-aborted.mp4", randomBytes(MULTIPART_THRESHOLD + 10));
    const controller = new AbortController();
    s3.fault = (req) => {
      if (req.method === "PUT") controller.abort(new Error("upload cancelled"));
      return null;
    };
    await assert.rejects(s3Driver().putFile("videos/aborted.mp4", source, { contentType: "video/mp4", signal: controller.signal }));
    assert.equal(s3.uploads.size, 0);
    assert.equal(s3.objects.has("videos/aborted.mp4"), false);
  });

  it("accepts a completion whose answer was lost", async () => {
    const size = MULTIPART_THRESHOLD + 5;
    const source = tempFile("s3-lost.mp4", randomBytes(size));
    let lost = false;
    s3.fault = (req) => {
      if (lost || req.method !== "POST" || !req.query.some(([k]) => k === "uploadId")) return null;
      lost = true;
      return { status: 500, code: "InternalError", afterHandling: true };
    };
    await s3Driver().putFile("videos/lost.mp4", source, { contentType: "video/mp4" });
    assert.equal(s3.count("POST", "uploadId"), 2, "the completion was retried and found no upload");
    assert.equal(s3.objects.get("videos/lost.mp4")!.bytes.byteLength, size);
    assert.equal(s3.count("DELETE", "uploadId"), 0, "a finished upload is not aborted");
  });

  it("reads playlists with a single request", async () => {
    const driver = s3Driver();
    await driver.putBytes("videos/l/b/hls/v1/master.m3u8", Buffer.from("#EXTM3U\n"), { contentType: "application/vnd.apple.mpegurl" });
    s3.requests.length = 0;
    assert.equal(await driver.readText("videos/l/b/hls/v1/master.m3u8", 4096), "#EXTM3U\n");
    assert.equal(s3.requests.length, 1);
    assert.equal(s3.requests[0]!.method, "GET");
  });

  it("relays content type, validators and ranges of stored objects", async () => {
    const driver = s3Driver();
    await driver.putBytes("videos/a.mp4", Buffer.from("0123456789"), { contentType: "video/mp4", cacheControl: "private, max-age=0" });
    const result = await driver.read("videos/a.mp4", "bytes=0-3");
    assert.ok(result && result !== "unsatisfiable");
    assert.equal(result.contentType, "video/mp4");
    assert.match(result.etag!, /^"[0-9a-f]{32}"$/);
    assert.ok(result.lastModified instanceof Date);
    await result.body.cancel();
    assert.equal(s3.requests.at(-1)!.headers.range, "bytes=0-3");
    const whole = await driver.read("videos/a.mp4", "bytes=0-1,3-4");
    assert.ok(whole && whole !== "unsatisfiable");
    await whole.body.cancel();
    assert.equal(s3.requests.at(-1)!.headers.range, undefined, "unsupported ranges are not forwarded");
  });

  it("deletes a prefix in batches", async () => {
    const driver = s3Driver();
    for (let i = 0; i < 12; i++) await driver.putBytes(`videos/l/b/hls/v1/720p/seg_${i}.m4s`, Buffer.from("s"), { contentType: "video/iso.segment" });
    await driver.putBytes("videos/l/b/source.mp4", Buffer.from("s"), { contentType: "video/mp4" });
    s3.requests.length = 0;
    assert.equal(await driver.deletePrefix("videos/l/b/hls/v1/"), 12);
    assert.equal(s3.count("POST", "delete"), 1);
    assert.equal(s3.count("DELETE"), 0);
    assert.deepEqual([...s3.objects.keys()], ["videos/l/b/source.mp4"]);
  });

  it("falls back to single deletes where batch deletion is not implemented", async () => {
    const plain = await startFakeS3({ multiDelete: false });
    try {
      const driver = s3Driver(plain);
      for (let i = 0; i < 5; i++) await driver.putBytes(`hls/v1/seg_${i}.m4s`, Buffer.from("s"), { contentType: "video/iso.segment" });
      assert.equal(await driver.deletePrefix("hls/v1/"), 5);
      assert.equal(plain.objects.size, 0);
      assert.equal(plain.count("DELETE"), 5);
    } finally {
      await plain.close();
    }
  });

  it("reports objects the service would not delete", async () => {
    const driver = s3Driver();
    await driver.putBytes("hls/v1/seg_1.m4s", Buffer.from("s"), { contentType: "video/iso.segment" });
    await driver.putBytes("hls/v1/locked.m4s", Buffer.from("s"), { contentType: "video/iso.segment" });
    await assert.rejects(driver.deletePrefix("hls/v1/"), /1 of 2 files could not be deleted: Access Denied/);
  });

  it("hands ffmpeg a presigned URL", async () => {
    const driver = s3Driver();
    await driver.putBytes("videos/source.mp4", Buffer.from("source video"), { contentType: "video/mp4" });
    const input = await driver.processingInput("videos/source.mp4", 600);
    assert.equal(input.type, "url");
    assert.equal(new URL(input.input).searchParams.get("X-Amz-Expires"), "600");
    const res = await fetch(input.input, { headers: { range: "bytes=0-5" } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), "source");
  });
});

/* ------------------------------------------------------------------ */
/* Driver selection                                                     */
/* ------------------------------------------------------------------ */

describe("driver selection", () => {
  const original = { ...storageEnv };
  const settings = (cdnBaseUrl?: string) => ({ storage: { cdnBaseUrl, transcodeToHls: true, renditions: [720], autoTranscribe: false } });

  function switchToS3(patch: Partial<typeof storageEnv> = {}): void {
    Object.assign(storageEnv, { driver: "s3", endpoint: s3.endpoint, region: "auto", bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, publicBaseUrl: "", forcePathStyle: false }, patch);
  }

  function writeLocal(key: string, content: string | Uint8Array): string {
    const file = path.join(uploadRoot(), ...key.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    return file;
  }

  beforeEach(() => {
    Object.assign(storageEnv, original);
    s3.objects.clear();
    s3.uploads.clear();
    s3.requests.length = 0;
    s3.fault = null;
    rmSync(uploadRoot(), { recursive: true, force: true });
    mkdirSync(uploadRoot(), { recursive: true });
  });
  after(() => {
    Object.assign(storageEnv, original);
  });

  it("uses the upload folder unless S3 is fully configured", async () => {
    assert.equal(getStorage().kind, "local");
    assert.equal(isRemoteStorage(), false);
    assert.equal(s3Client(), null);
    assert.equal(localStorage().root, uploadRoot());
    assert.equal(publicBaseUrl(settings("https://cdn.example.com")), null, "with local storage the CDN sits in front of the site");
    assert.equal(await offloadLocalFile("logo.png", "image/png"), false);
    assert.deepEqual(await migrateLocalToRemote(), { moved: 0, failed: 0, bytes: 0, more: false, errors: [] });

    switchToS3({ secretAccessKey: "" });
    assert.equal(getStorage().kind, "local", "a missing secret keeps files local");
    const status = await getStorageStatus();
    assert.equal(status.driver, "local");
    assert.equal(status.misconfigured, true);
    assert.deepEqual(status.missing, ["S3_SECRET_ACCESS_KEY"]);
    assert.equal(status.s3!.secretSet, false);
  });

  it("switches to the bucket and rebuilds the client when the configuration changes", () => {
    switchToS3();
    const first = getStorage();
    assert.equal(first.kind, "s3");
    assert.equal(isRemoteStorage(), true);
    assert.equal(getStorage(), first, "the driver is cached");
    assert.equal(s3Client()!.bucket, s3.bucket);
    switchToS3({ bucket: "another-bucket" });
    assert.notEqual(getStorage(), first);
    assert.equal(s3Client()!.bucket, "another-bucket");
  });

  it("reports the configuration without revealing secrets", async () => {
    switchToS3({ publicBaseUrl: "https://cdn.example.com" });
    const status = await getStorageStatus();
    assert.equal(status.driver, "s3");
    assert.equal(status.misconfigured, false);
    assert.deepEqual(status.missing, []);
    assert.equal(status.localDir, uploadRoot());
    assert.equal(status.s3!.provider, "MinIO");
    assert.equal(status.s3!.region, "us-east-1");
    assert.equal(status.s3!.pathStyle, true, "an IP endpoint is addressed path-style without S3_FORCE_PATH_STYLE");
    assert.equal(status.s3!.bucket, s3.bucket);
    assert.equal(status.s3!.secretSet, true);
    assert.notEqual(status.s3!.accessKeyId, s3.accessKeyId);
    assert.ok(status.s3!.accessKeyId.includes("…"));
    assert.ok(!JSON.stringify(status).includes(s3.secretAccessKey));
    if (status.disk) assert.ok(status.disk.total >= status.disk.free && status.disk.free >= 0);

    for (const [endpoint, provider, region] of [
      ["", "Amazon S3", "us-east-1"],
      ["https://abc.r2.cloudflarestorage.com", "Cloudflare R2", "auto"],
      ["https://s3.us-west-004.backblazeb2.com", "Backblaze B2", "us-west-004"],
      ["https://storage.example.net", "S3-compatible", "us-east-1"],
    ] as const) {
      switchToS3({ endpoint });
      const s3Status = (await getStorageStatus()).s3!;
      assert.deepEqual([s3Status.provider, s3Status.region, s3Status.pathStyle], [provider, region, false]);
    }
  });

  it("public URLs: settings CDN first, then S3_PUBLIC_BASE_URL, http(s) only", () => {
    switchToS3();
    assert.equal(publicBaseUrl(settings()), null);
    switchToS3({ publicBaseUrl: "https://pub-123.r2.dev" });
    assert.equal(publicBaseUrl(settings()), "https://pub-123.r2.dev");
    assert.equal(publicBaseUrl(settings("https://cdn.example.com//")), "https://cdn.example.com");
    assert.equal(publicBaseUrl(settings("  ")), "https://pub-123.r2.dev");
    assert.equal(publicBaseUrl(settings("javascript:alert(1)")), null);
    assert.equal(publicBaseUrl(settings("//cdn.example.com")), null);
  });

  it("keeps videos out of shared caches", () => {
    assert.equal(cacheControlForKey("videos/a.mp4"), "private, max-age=0");
    assert.equal(cacheControlForKey("Videos/l/b/hls/v1/master.m3u8"), "private, max-age=0");
    assert.equal(cacheControlForKey("logo.png"), "public, max-age=31536000, immutable");
    assert.equal(cacheControlForKey("videos.png"), "public, max-age=31536000, immutable");
  });

  it("moves a received file to the bucket and reads it from there afterwards", async () => {
    switchToS3();
    const file = writeLocal("videos/intro-abc.mp4", "video bytes");
    assert.equal((await storageFor("videos/intro-abc.mp4")).kind, "local", "files still on disk are served from disk");
    assert.equal(await offloadLocalFile("videos/intro-abc.mp4", "video/mp4"), true);
    assert.equal(existsSync(file), false);
    const stored = s3.objects.get("videos/intro-abc.mp4")!;
    assert.equal(stored.bytes.toString(), "video bytes");
    assert.equal(stored.contentType, "video/mp4");
    assert.equal(stored.cacheControl, "private, max-age=0");
    assert.equal((await storageFor("videos/intro-abc.mp4")).kind, "s3");
    assert.equal(await offloadLocalFile("videos/intro-abc.mp4", "video/mp4"), false, "nothing left to move");
  });

  it("keeps the local copy when the bucket refuses the file", async () => {
    switchToS3();
    const file = writeLocal("logo-abc.png", "png");
    s3.fault = () => ({ status: 403, code: "AccessDenied", message: "Access Denied" });
    await assert.rejects(offloadLocalFile("logo-abc.png", "image/png"), /Access Denied/);
    assert.ok(existsSync(file));
  });

  it("migrates leftover local files in limited runs, skipping work in progress", async () => {
    switchToS3();
    writeLocal("logo-abc.png", "png");
    writeLocal("videos/a.mp4", "aaaa");
    writeLocal("videos/les_1/blk_1/hls/v1/master.m3u8", "#EXTM3U\n");
    writeLocal(".uploads/session.part", "partial upload");
    writeLocal("videos/.transcode/job/seg.m4s", "in progress");
    writeLocal(".app-secret", "secret");
    assert.deepEqual(await localUsage(), { files: 3, bytes: 3 + 4 + 8 });

    const types: string[] = [];
    const first = await migrateLocalToRemote(2, (key) => {
      types.push(key);
      return key.endsWith(".png") ? "image/png" : "application/octet-stream";
    });
    assert.equal(first.moved, 2);
    assert.equal(first.failed, 0);
    assert.equal(first.more, true);
    assert.equal(types.length, 2);

    const second = await migrateLocalToRemote(2);
    assert.deepEqual([second.moved, second.failed, second.more], [1, 0, false]);
    assert.equal(first.bytes + second.bytes, 15);
    assert.deepEqual([...s3.objects.keys()].sort(), ["logo-abc.png", "videos/a.mp4", "videos/les_1/blk_1/hls/v1/master.m3u8"]);
    assert.equal(s3.objects.get("logo-abc.png")!.contentType, "image/png");
    assert.deepEqual(await localUsage(), { files: 0, bytes: 0 });
    assert.ok(existsSync(path.join(uploadRoot(), ".uploads", "session.part")));
    assert.ok(existsSync(path.join(uploadRoot(), "videos", ".transcode", "job", "seg.m4s")));
    assert.ok(existsSync(path.join(uploadRoot(), ".app-secret")));
  });

  it("counts files the bucket refused and explains why", async () => {
    switchToS3();
    writeLocal("a.png", "a");
    writeLocal("b.png", "b");
    s3.fault = (req) => (req.path.endsWith("/a.png") ? { status: 403, code: "AccessDenied", message: "Access Denied" } : null);
    const result = await migrateLocalToRemote();
    assert.deepEqual([result.moved, result.failed, result.more], [1, 1, false]);
    assert.deepEqual(result.errors, ["a.png: Access Denied"]);
    assert.ok(existsSync(path.join(uploadRoot(), "a.png")));
  });

  it("tests the local folder: write, read, delete", async () => {
    const result = await testStorageConnection();
    assert.equal(result.driver, "local");
    assert.deepEqual(result.steps.map((s) => [s.step, s.ok]), [["write", true], ["read", true], ["delete", true]]);
    assert.deepEqual(await localUsage(), { files: 0, bytes: 0 });
  });

  it("tests the bucket: write, read, presigned download, delete", async () => {
    switchToS3();
    const result = await testStorageConnection();
    assert.equal(result.driver, "s3");
    assert.deepEqual(result.steps.map((s) => [s.step, s.ok]), [["write", true], ["read", true], ["signed-url", true], ["delete", true]]);
    assert.ok(result.steps.every((s) => Number.isInteger(s.ms) && s.ms >= 0));
    assert.equal(s3.objects.size, 0, "the probe object is removed");
  });

  it("stops the connection test at the first failing step with the service's message", async () => {
    switchToS3({ secretAccessKey: "wrong-secret" });
    const denied = await testStorageConnection();
    assert.equal(denied.steps.length, 1);
    assert.equal(denied.steps[0]!.step, "write");
    assert.equal(denied.steps[0]!.ok, false);
    assert.match(denied.steps[0]!.error!, /signature/i);
    assert.ok(!JSON.stringify(denied).includes("wrong-secret"));

    switchToS3({ endpoint: "http://127.0.0.1:1" });
    const unreachable = await testStorageConnection();
    assert.equal(unreachable.steps[0]!.ok, false);
    assert.match(unreachable.steps[0]!.error!, /fetch failed|ECONNREFUSED/);
  });
});

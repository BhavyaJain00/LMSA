import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MAX_DELETE_BATCH, S3Client, S3Error, resolveSigningRegion, retryDelayMs, usesPathStyle, xmlText, xmlTexts, type S3Config } from "@/lib/storage/s3";
import { startFakeS3, type FakeS3Server } from "./helpers/fake-s3";

/**
 * The hand-written S3 client: URL styles for each provider, and every
 * operation against an in-memory S3 service that re-checks the SigV4
 * signature of what really arrives on the wire.
 */

const KEYS = { accessKeyId: "AKIAEXAMPLEEXAMPLE01", secretAccessKey: "secret/example+key" };

function config(patch: Partial<S3Config>): S3Config {
  return { endpoint: "", region: "auto", bucket: "lms-media", forcePathStyle: false, ...KEYS, ...patch };
}

/** A client whose requests are captured instead of sent. */
function capturing(patch: Partial<S3Config>, answer: () => Response = () => new Response(null, { status: 200, headers: { etag: '"e"' } })) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method), headers: { ...(init?.headers as Record<string, string>) } });
    return answer();
  }) as typeof fetch;
  const client = new S3Client(config(patch), {
    fetch: fetchImpl,
    now: () => new Date("2026-03-01T10:00:00Z"),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls, sleeps };
}

describe("signing region", () => {
  it("keeps an explicit region and infers the rest from the endpoint", () => {
    const cases: [string, string, string][] = [
      ["", "auto", "us-east-1"],
      ["", "", "us-east-1"],
      ["", "eu-central-1", "eu-central-1"],
      ["https://0123456789abcdef.r2.cloudflarestorage.com", "auto", "auto"],
      ["https://0123456789abcdef.eu.r2.cloudflarestorage.com", "auto", "auto"],
      ["https://s3.us-west-004.backblazeb2.com", "auto", "us-west-004"],
      ["https://s3.us-west-004.backblazeb2.com", "eu-central-003", "eu-central-003"],
      ["https://s3.eu-west-3.amazonaws.com", "auto", "eu-west-3"],
      ["https://s3.dualstack.ap-south-1.amazonaws.com", "AUTO", "ap-south-1"],
      ["https://s3.eu-central-1.wasabisys.com", "auto", "eu-central-1"],
      ["https://s3.amazonaws.com", "auto", "us-east-1"],
      ["http://localhost:9000", "auto", "us-east-1"],
      ["https://minio.internal.example.com", "auto", "us-east-1"],
      ["https://nyc3.digitaloceanspaces.com", "auto", "us-east-1"],
      ["not a url", "auto", "us-east-1"],
    ];
    for (const [endpoint, region, expected] of cases) assert.equal(resolveSigningRegion(endpoint, region), expected, `${endpoint || "(aws)"} / ${region}`);
  });
});

describe("path-style or virtual-hosted URLs", () => {
  it("chooses path style when asked, for IP/localhost endpoints and for dotted bucket names", () => {
    assert.equal(usesPathStyle({ endpoint: "", bucket: "media", forcePathStyle: false }), false);
    assert.equal(usesPathStyle({ endpoint: "", bucket: "media", forcePathStyle: true }), true);
    assert.equal(usesPathStyle({ endpoint: "", bucket: "media.example.com", forcePathStyle: false }), true);
    assert.equal(usesPathStyle({ endpoint: "http://localhost:9000", bucket: "media", forcePathStyle: false }), true);
    assert.equal(usesPathStyle({ endpoint: "http://127.0.0.1:9000", bucket: "media", forcePathStyle: false }), true);
    assert.equal(usesPathStyle({ endpoint: "http://[::1]:9000", bucket: "media", forcePathStyle: false }), true);
    assert.equal(usesPathStyle({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "media", forcePathStyle: false }), false);
    assert.equal(usesPathStyle({ endpoint: "https://s3.us-west-004.backblazeb2.com", bucket: "media", forcePathStyle: false }), false);
  });

  it("AWS S3: bucket host name in the signing region", async () => {
    const { client, calls } = capturing({ region: "eu-west-1" });
    await client.putObject("videos/my clip.mp4", Buffer.from("x"));
    assert.equal(calls[0]!.url, "https://lms-media.s3.eu-west-1.amazonaws.com/videos/my%20clip.mp4");
    assert.match(calls[0]!.headers.authorization!, /Credential=AKIAEXAMPLEEXAMPLE01\/20260301\/eu-west-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, /);
    assert.equal(calls[0]!.headers["x-amz-date"], "20260301T100000Z");
    assert.equal(calls[0]!.headers["x-amz-content-sha256"], createHash("sha256").update("x").digest("hex"));
    assert.equal(calls[0]!.headers.host, undefined);
  });

  it("AWS S3 without a region signs for us-east-1", () => {
    assert.deepEqual(new S3Client(config({})).target("a.png"), { protocol: "https:", host: "lms-media.s3.us-east-1.amazonaws.com", path: "/a.png" });
    assert.deepEqual(new S3Client(config({ forcePathStyle: true })).target("a.png"), { protocol: "https:", host: "s3.us-east-1.amazonaws.com", path: "/lms-media/a.png" });
  });

  it("Cloudflare R2: bucket sub-domain of the account endpoint, region auto", async () => {
    const { client, calls } = capturing({ endpoint: "https://0123456789abcdef.r2.cloudflarestorage.com/" });
    await client.headObject("logo.png");
    assert.equal(calls[0]!.url, "https://lms-media.0123456789abcdef.r2.cloudflarestorage.com/logo.png");
    assert.match(calls[0]!.headers.authorization!, /\/20260301\/auto\/s3\/aws4_request/);
  });

  it("Backblaze B2: region taken from the endpoint", async () => {
    const { client, calls } = capturing({ endpoint: "https://s3.us-west-004.backblazeb2.com" });
    await client.deleteObject("old.pdf");
    assert.equal(calls[0]!.url, "https://lms-media.s3.us-west-004.backblazeb2.com/old.pdf");
    assert.equal(calls[0]!.method, "DELETE");
    assert.match(calls[0]!.headers.authorization!, /\/us-west-004\/s3\/aws4_request/);
  });

  it("MinIO: path style, port kept, bucket listing at the bucket path", async () => {
    const { client, calls } = capturing({ endpoint: "http://localhost:9000" }, () => new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"));
    assert.deepEqual(client.target("videos/a.mp4"), { protocol: "http:", host: "localhost:9000", path: "/lms-media/videos/a.mp4" });
    await client.listKeys("videos/");
    assert.equal(calls[0]!.url, "http://localhost:9000/lms-media?list-type=2&prefix=videos%2F");
  });

  it("keeps a base path of the endpoint (reverse proxies)", () => {
    const client = new S3Client(config({ endpoint: "https://files.example.com/s3/", forcePathStyle: true }));
    assert.deepEqual(client.target("a/b.txt"), { protocol: "https:", host: "files.example.com", path: "/s3/lms-media/a/b.txt" });
    assert.deepEqual(client.target(""), { protocol: "https:", host: "files.example.com", path: "/s3/lms-media" });
  });

  it("presigned URLs use the same addressing", () => {
    const { client } = capturing({ endpoint: "http://127.0.0.1:9000" });
    const url = new URL(client.presignGet("videos/a b.mp4", 900));
    assert.equal(url.origin, "http://127.0.0.1:9000");
    assert.equal(url.pathname, "/lms-media/videos/a%20b.mp4");
    assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
    assert.equal(url.searchParams.get("X-Amz-Credential"), "AKIAEXAMPLEEXAMPLE01/20260301/us-east-1/s3/aws4_request");
    assert.match(url.searchParams.get("X-Amz-Signature")!, /^[0-9a-f]{64}$/);
  });
});

describe("retries", () => {
  it("waits for Retry-After, else backs off exponentially with jitter", () => {
    assert.equal(retryDelayMs(1, null, () => 0), 300);
    assert.equal(retryDelayMs(2, null, () => 0), 600);
    assert.equal(retryDelayMs(3, null, () => 1), 1500);
    assert.equal(retryDelayMs(1, "2"), 2000);
    assert.equal(retryDelayMs(1, "3600"), 10_000);
    assert.equal(retryDelayMs(1, "soon", () => 0), 300);
    assert.equal(retryDelayMs(1, "", () => 0), 300);
  });

  it("retries network failures up to four attempts, then reports the last one", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = new S3Client(config({}), {
      fetch: (async () => {
        calls++;
        throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
      }) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await assert.rejects(client.headObject("a.png"), /fetch failed/);
    assert.equal(calls, 4);
    assert.equal(sleeps.length, 3);
    assert.ok(sleeps[0]! < sleeps[1]! && sleeps[1]! < sleeps[2]!, "the wait grows");
  });

  it("recovers when a later attempt succeeds", async () => {
    let calls = 0;
    const client = new S3Client(config({}), {
      fetch: (async () => {
        if (++calls < 3) throw new TypeError("fetch failed");
        return new Response(null, { status: 200, headers: { "content-length": "7", etag: '"abc"' } });
      }) as typeof fetch,
      sleep: async () => undefined,
    });
    assert.deepEqual(await client.headObject("a.png"), { size: 7, contentType: undefined, etag: '"abc"', lastModified: undefined });
    assert.equal(calls, 3);
  });

  it("tries a timed-out request only once more", async () => {
    let calls = 0;
    const client = new S3Client(config({}), {
      fetch: (async () => {
        calls++;
        throw new DOMException("The operation timed out.", "TimeoutError");
      }) as typeof fetch,
      sleep: async () => undefined,
    });
    await assert.rejects(client.deleteObject("a.png"), { name: "TimeoutError" });
    assert.equal(calls, 2);
  });

  it("does not retry once the caller aborted", async () => {
    let calls = 0;
    const controller = new AbortController();
    const client = new S3Client(config({}), {
      fetch: (async (_url: unknown, init?: RequestInit) => {
        calls++;
        controller.abort(new Error("cancelled by the user"));
        init?.signal?.throwIfAborted();
        return new Response(null);
      }) as typeof fetch,
      sleep: async () => undefined,
    });
    await assert.rejects(client.putObject("a.png", Buffer.from("x"), { signal: controller.signal }), /cancelled by the user/);
    assert.equal(calls, 1);
    await assert.rejects(client.putObject("a.png", Buffer.from("x"), { signal: controller.signal }), /cancelled by the user/);
    assert.equal(calls, 1, "an already aborted signal sends nothing");
  });

  it("does not retry client errors", async () => {
    const { client, calls, sleeps } = capturing({}, () => new Response("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", { status: 403 }));
    await assert.rejects(client.putObject("a.png", Buffer.from("x")), (err: unknown) => err instanceof S3Error && err.status === 403 && err.code === "AccessDenied" && err.message === "Access Denied");
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("names the bucket's region when the request went to the wrong one", async () => {
    const redirect = capturing({ region: "us-east-1" }, () => new Response(null, { status: 301, headers: { "x-amz-bucket-region": "eu-west-2" } }));
    await assert.rejects(redirect.client.headObject("a.png"), /The bucket is in region "eu-west-2", not "us-east-1"\. Set S3_REGION=eu-west-2\./);
    assert.equal(redirect.calls.length, 1);
    const malformed = capturing(
      { region: "us-east-1" },
      () => new Response("<Error><Code>AuthorizationHeaderMalformed</Code><Message>wrong region</Message><Region>ap-south-1</Region></Error>", { status: 400 }),
    );
    await assert.rejects(malformed.client.getObject("a.png"), /Set S3_REGION=ap-south-1\./);
  });
});

describe("XML helpers", () => {
  it("decode entities", () => {
    const xml = "<R><Key>a &amp; b &lt;1&gt;.txt</Key><Key>caf&#233; &#x1F600;</Key><Message>it&apos;s &quot;fine&quot;</Message></R>";
    assert.equal(xmlText(xml, "Message"), "it's \"fine\"");
    assert.deepEqual(xmlTexts(xml, "Key"), ["a & b <1>.txt", "café 😀"]);
    assert.equal(xmlText(xml, "Missing"), null);
    assert.equal(xmlText("<Key>&amp;lt;</Key>", "Key"), "&lt;", "decoded once");
  });
});

describe("S3 client against a signature-checking service", () => {
  let s3: FakeS3Server;
  let client: S3Client;
  let sleeps: number[];

  before(async () => {
    s3 = await startFakeS3();
  });
  after(async () => {
    await s3.close();
  });
  beforeEach(() => {
    s3.objects.clear();
    s3.uploads.clear();
    s3.requests.length = 0;
    s3.fault = null;
    sleeps = [];
    client = new S3Client(
      { endpoint: s3.endpoint, region: "auto", bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, forcePathStyle: false },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
  });

  it("puts, heads, gets and deletes an object", async () => {
    const body = Buffer.from("Welcome to the course.");
    const put = await client.putObject("docs/welcome.txt", body, { contentType: "text/plain; charset=utf-8", cacheControl: "public, max-age=60" });
    assert.match(put.etag!, /^"[0-9a-f]{32}"$/);
    assert.equal(s3.objects.get("docs/welcome.txt")!.cacheControl, "public, max-age=60");

    const info = await client.headObject("docs/welcome.txt");
    assert.equal(info!.size, body.byteLength);
    assert.equal(info!.contentType, "text/plain; charset=utf-8");
    assert.equal(info!.etag, put.etag);
    assert.ok(info!.lastModified instanceof Date && !Number.isNaN(info!.lastModified.getTime()));

    const res = await client.getObject("docs/welcome.txt");
    assert.equal(res!.status, 200);
    assert.equal(await res!.text(), "Welcome to the course.");

    await client.deleteObject("docs/welcome.txt");
    assert.equal(await client.headObject("docs/welcome.txt"), null);
    assert.equal(await client.getObject("docs/welcome.txt"), null);
    await client.deleteObject("docs/welcome.txt");
  });

  it("signs keys with spaces, unicode and reserved characters exactly as they are sent", async () => {
    const keys = ["videos/my clip (final) v2.mp4", "notes/résumé+draft=1&2.txt", "a/$price/100%.txt", "emoji/😀.txt", "tilde~star*'quote'.txt"];
    for (const key of keys) {
      await client.putObject(key, Buffer.from(key));
      const res = await client.getObject(key);
      assert.equal(await res!.text(), key, key);
    }
    assert.deepEqual([...s3.objects.keys()].sort(), [...keys].sort());
    assert.ok(s3.requests.every((r) => !/[ ()$+='*&]/.test(r.rawPath)), "paths go out fully percent-encoded");
  });

  it("rejects a wrong secret", async () => {
    const wrong = new S3Client({ endpoint: s3.endpoint, region: "auto", bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: "not-the-secret", forcePathStyle: true });
    await assert.rejects(wrong.putObject("a.txt", Buffer.from("x")), (err: unknown) => err instanceof S3Error && err.code === "SignatureDoesNotMatch" && err.status === 403);
    assert.equal(s3.objects.size, 0);
  });

  it("reads byte ranges and relays an unsatisfiable range", async () => {
    await client.putObject("videos/a.mp4", Buffer.from("0123456789"));
    const part = await client.getObject("videos/a.mp4", { range: "bytes=2-5" });
    assert.equal(part!.status, 206);
    assert.equal(part!.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await part!.text(), "2345");
    const tail = await client.getObject("videos/a.mp4", { range: "bytes=-3" });
    assert.equal(await tail!.text(), "789");
    const open = await client.getObject("videos/a.mp4", { range: "bytes=7-" });
    assert.equal(open!.headers.get("content-range"), "bytes 7-9/10");
    await open!.body?.cancel();
    const bad = await client.getObject("videos/a.mp4", { range: "bytes=50-60" });
    assert.equal(bad!.status, 416);
    await bad!.body?.cancel();
  });

  it("uploads in parts and completes them in order", async () => {
    const first = Buffer.alloc(5 * 1024 * 1024, 1);
    const second = Buffer.from("the end");
    const uploadId = await client.createMultipartUpload("videos/big.mp4", { contentType: "video/mp4", cacheControl: "private, max-age=0" });
    assert.match(uploadId, /[/+=]/, "upload ids with reserved characters survive the round trip");
    // Out of order on purpose: completion sorts by part number.
    const p2 = await client.uploadPart("videos/big.mp4", uploadId, 2, second);
    const p1 = await client.uploadPart("videos/big.mp4", uploadId, 1, first);
    await client.completeMultipartUpload("videos/big.mp4", uploadId, [p2, p1]);
    const stored = s3.objects.get("videos/big.mp4")!;
    assert.equal(stored.bytes.byteLength, first.byteLength + second.byteLength);
    assert.equal(stored.bytes.subarray(first.byteLength).toString(), "the end");
    assert.equal(stored.contentType, "video/mp4");
    assert.equal(stored.cacheControl, "private, max-age=0");
    assert.equal(s3.uploads.size, 0);
  });

  it("reports a rejected completion and aborts uploads", async () => {
    const uploadId = await client.createMultipartUpload("videos/small-parts.mp4");
    const p1 = await client.uploadPart("videos/small-parts.mp4", uploadId, 1, Buffer.from("too small"));
    const p2 = await client.uploadPart("videos/small-parts.mp4", uploadId, 2, Buffer.from("last"));
    await assert.rejects(client.completeMultipartUpload("videos/small-parts.mp4", uploadId, [p1, p2]), (err: unknown) => err instanceof S3Error && err.code === "EntityTooSmall");
    await client.abortMultipartUpload("videos/small-parts.mp4", uploadId);
    assert.equal(s3.uploads.size, 0);
    await client.abortMultipartUpload("videos/small-parts.mp4", uploadId);
    await assert.rejects(client.uploadPart("videos/small-parts.mp4", uploadId, 1, Buffer.from("x")), (err: unknown) => err instanceof S3Error && err.code === "NoSuchUpload");
  });

  it("treats an error inside a 200 completion answer as a failure", async () => {
    let answers = 0;
    const flaky = new S3Client(config({}), {
      fetch: (async () => {
        answers++;
        return new Response(answers < 3 ? "<Error><Code>InternalError</Code><Message>We encountered an internal error.</Message></Error>" : "<CompleteMultipartUploadResult><ETag>x</ETag></CompleteMultipartUploadResult>");
      }) as typeof fetch,
      sleep: async () => undefined,
    });
    await flaky.completeMultipartUpload("k", "id", [{ partNumber: 1, etag: '"a"' }]);
    assert.equal(answers, 3);

    const broken = new S3Client(config({}), { fetch: (async () => new Response("<Error><Code>InvalidPart</Code><Message>Part 1 is missing.</Message></Error>")) as typeof fetch, sleep: async () => undefined });
    await assert.rejects(broken.completeMultipartUpload("k", "id", [{ partNumber: 1, etag: '"a"' }]), (err: unknown) => err instanceof S3Error && err.code === "InvalidPart" && err.message === "Part 1 is missing.");
  });

  it("lists keys across pages and stops at the limit", async () => {
    const paged = await startFakeS3({ pageSize: 2 });
    try {
      const c = new S3Client({ endpoint: paged.endpoint, region: "auto", bucket: paged.bucket, accessKeyId: paged.accessKeyId, secretAccessKey: paged.secretAccessKey, forcePathStyle: true });
      const keys = ["videos/l1/b1/hls/v1/master.m3u8", "videos/l1/b1/hls/v1/720p/seg_1.m4s", "videos/l1/b1/hls/v1/720p/seg_2.m4s", "videos/l1/b1/hls/v1/a & b <c>.m4s", "videos/l2/x.mp4", "logo.png"];
      for (const key of keys) await c.putObject(key, Buffer.from("x"));
      assert.deepEqual(await c.listKeys("videos/l1/"), keys.filter((k) => k.startsWith("videos/l1/")).sort());
      assert.equal(paged.count("GET", "list-type"), 2);
      assert.deepEqual(await c.listKeys("nothing/"), []);
      assert.equal((await c.listKeys("", 2)).length, 2, "no further page is requested once the limit is reached");
      assert.equal((await c.listKeys("")).length, keys.length);
    } finally {
      await paged.close();
    }
  });

  it("deletes objects in one batch and reports the ones that could not be deleted", async () => {
    for (const key of ["hls/a.m4s", "hls/b & c.m4s", "hls/locked.m4s", "keep.png"]) await client.putObject(key, Buffer.from("x"));
    s3.requests.length = 0;
    const failed = await client.deleteObjects(["hls/a.m4s", "hls/b & c.m4s", "hls/locked.m4s", "hls/never-existed.m4s"]);
    assert.deepEqual(failed, [{ key: "hls/locked.m4s", code: "AccessDenied", message: "Access Denied" }]);
    assert.deepEqual([...s3.objects.keys()].sort(), ["hls/locked.m4s", "keep.png"]);
    assert.equal(s3.requests.length, 1);
    assert.deepEqual(await client.deleteObjects([]), []);
    assert.equal(s3.requests.length, 1, "an empty batch sends nothing");
    await assert.rejects(client.deleteObjects(Array.from({ length: MAX_DELETE_BATCH + 1 }, (_, i) => `k${i}`)), /At most 1000/);
  });

  it("presigned URLs download without credentials until they expire", async () => {
    await client.putObject("videos/intro.mp4", Buffer.from("video bytes"), { contentType: "video/mp4" });
    const url = client.presignGet("videos/intro.mp4", 300, { contentType: "application/octet-stream" });
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(await res.text(), "video bytes");

    const ranged = await fetch(url, { headers: { range: "bytes=0-4" } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "video");

    const tampered = await fetch(url.replace("intro.mp4", "other.mp4"));
    assert.equal(tampered.status, 403);
    await tampered.body?.cancel();

    const past = new S3Client(
      { endpoint: s3.endpoint, region: "auto", bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, forcePathStyle: true },
      { now: () => new Date(Date.now() - 3_600_000) },
    );
    const expired = await fetch(past.presignGet("videos/intro.mp4", 60));
    assert.equal(expired.status, 403);
    assert.match(await expired.text(), /Request has expired/);
  });

  it("retries throttling and server errors, signing each attempt", async () => {
    let failures = 2;
    s3.fault = (req) => {
      if (req.method !== "PUT" || failures-- <= 0) return null;
      const headers: Record<string, string> = failures === 1 ? { "Retry-After": "1" } : {};
      return { status: 503, code: "SlowDown", message: "Please reduce your request rate.", headers };
    };
    await client.putObject("a.txt", Buffer.from("x"));
    assert.equal(s3.count("PUT"), 3);
    assert.equal(sleeps.length, 2);
    assert.equal(sleeps[0], 1000, "Retry-After is honoured");
    assert.ok(s3.objects.has("a.txt"));
  });

  it("gives up after four attempts with the service's error", async () => {
    s3.fault = () => ({ status: 500, code: "InternalError", message: "We encountered an internal error. Please try again." });
    await assert.rejects(client.putObject("a.txt", Buffer.from("x")), (err: unknown) => err instanceof S3Error && err.status === 500 && err.code === "InternalError");
    assert.equal(s3.count("PUT"), 4);
    assert.equal(sleeps.length, 3);
  });

  it("retries a dropped connection", async () => {
    let dropped = false;
    s3.fault = () => {
      if (dropped) return null;
      dropped = true;
      return { status: 0, destroy: true };
    };
    await client.putObject("a.txt", Buffer.from("x"));
    assert.equal(s3.count("PUT"), 2);
    assert.ok(s3.objects.has("a.txt"));
  });

  it("adopts the service's clock when its own is skewed", async () => {
    const ahead = await startFakeS3({ clock: () => new Date(Date.now() + 2 * 3_600_000) });
    try {
      const c = new S3Client({ endpoint: ahead.endpoint, region: "auto", bucket: ahead.bucket, accessKeyId: ahead.accessKeyId, secretAccessKey: ahead.secretAccessKey, forcePathStyle: true }, { sleep: async () => undefined });
      await c.putObject("a.txt", Buffer.from("x"));
      assert.equal(ahead.count("PUT"), 2, "one refused attempt, one signed with the corrected time");
      await c.putObject("b.txt", Buffer.from("y"));
      assert.equal(ahead.count("PUT"), 3, "later requests are right the first time");
      const res = await fetch(c.presignGet("a.txt", 60));
      assert.equal(res.status, 200, "presigned URLs use the corrected time too");
      await res.body?.cancel();
    } finally {
      await ahead.close();
    }
  });

  it("explains a region mismatch reported by the service", async () => {
    const regional = await startFakeS3({ region: "eu-west-1" });
    try {
      const wrong = new S3Client({ endpoint: regional.endpoint, region: "us-east-1", bucket: regional.bucket, accessKeyId: regional.accessKeyId, secretAccessKey: regional.secretAccessKey, forcePathStyle: true });
      await assert.rejects(wrong.putObject("a.txt", Buffer.from("x")), /The bucket is in region "eu-west-1", not "us-east-1"\. Set S3_REGION=eu-west-1\./);
      const right = new S3Client({ endpoint: regional.endpoint, region: "eu-west-1", bucket: regional.bucket, accessKeyId: regional.accessKeyId, secretAccessKey: regional.secretAccessKey, forcePathStyle: true });
      await right.putObject("a.txt", Buffer.from("x"));
      assert.ok(regional.objects.has("a.txt"));
    } finally {
      await regional.close();
    }
  });
});

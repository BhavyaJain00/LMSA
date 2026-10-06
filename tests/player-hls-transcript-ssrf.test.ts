import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { audioExtractArgs, inputProtocols, isPublicMediaUrl, isRefusedInputError, TRANSCRIBE_INPUT_FORMATS } from "@/lib/transcripts/stt";
import { SourceDownloadError, downloadPublicMedia, guardedMediaLookup, redirectTarget, type AddressResolver } from "@/lib/transcripts/source-download";

/**
 * Automatic transcription must not let a course manager point the server's
 * ffmpeg (or its downloader) at the server's own network.
 */

describe("player-hls transcription: ffmpeg input restrictions", () => {
  const at = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it("reads a local file through the file protocol only", () => {
    const args = audioExtractArgs("C:\\tmp\\ll-transcribe\\job\\source.media", "mp3");
    assert.equal(at(args, "-protocol_whitelist"), "file");
    assert.ok(args.indexOf("-protocol_whitelist") < args.indexOf("-i"), "input options come before -i");
  });

  it("reads a storage URL through http(s) only, never playlists' other protocols", () => {
    assert.equal(inputProtocols("https://bucket.s3.example.com/videos/a.mp4?X-Amz-Signature=x"), "http,https,tls,tcp");
    for (const input of ["/videos/a.mp4", "concat:a.mp4|b.mp4", "subfile,,start,0,end,0,,:/etc/passwd", "data:video/mp4;base64,AA=="]) {
      assert.equal(inputProtocols(input), "file", input);
    }
  });

  it("only opens video and audio containers (no hls, concat or other playlist demuxers)", () => {
    const args = audioExtractArgs("/videos/a.mp4", "wav");
    const formats = at(args, "-format_whitelist")!.split(",");
    assert.ok(args.indexOf("-format_whitelist") < args.indexOf("-i"));
    for (const allowed of ["mov", "mp4", "matroska", "webm", "ogg", "mp3"]) assert.ok(formats.includes(allowed), allowed);
    for (const refused of ["hls", "applehttp", "concat", "dash", "image2", "lavfi", "tee", "ffconcat"]) assert.ok(!formats.includes(refused), refused);
    assert.deepEqual(formats, [...TRANSCRIBE_INPUT_FORMATS]);
  });

  it("recognizes ffmpeg's whitelist refusals", () => {
    assert.ok(isRefusedInputError("[in#0 @ 0x1] Format not on whitelist 'mov,mp4'"));
    assert.ok(isRefusedInputError("Protocol 'http' not on whitelist 'file'!"));
    assert.ok(!isRefusedInputError("Invalid data found when processing input"));
  });
});

describe("player-hls transcription: public URL check", () => {
  it("refuses IPv6 forms that embed or tunnel to private IPv4 addresses", () => {
    for (const url of [
      "http://[64:ff9b::a9fe:a9fe]/latest/meta-data", // NAT64 of 169.254.169.254
      "http://[2002:7f00:1::]/a.mp4", // 6to4 of 127.0.0.1
      "http://[::127.0.0.1]/a.mp4",
      "http://[ff02::1]/a.mp4",
      "http://[2001:db8::1]/a.mp4",
      "http://media.home.arpa/a.mp4",
      "http://media.localdomain/a.mp4",
      "http://198.18.0.1/a.mp4",
      "http://0177.0.0.1/a.mp4",
    ]) {
      assert.equal(isPublicMediaUrl(url), false, url);
    }
  });

  it("accepts public addresses and host names", () => {
    assert.ok(isPublicMediaUrl("https://videos.example.org/lesson.mp4"));
    assert.ok(isPublicMediaUrl("http://93.184.216.34:8080/lesson.mp4"));
  });
});

describe("player-hls transcription: redirects", () => {
  it("resolves relative locations and keeps public targets", () => {
    assert.equal(redirectTarget("/files/b.mp4", "https://cdn.example.com/a.mp4"), "https://cdn.example.com/files/b.mp4");
    assert.equal(redirectTarget(["https://other.example.net/x.mp4#t=1"], "https://cdn.example.com/a.mp4"), "https://other.example.net/x.mp4");
  });

  it("refuses redirects to private, internal or non-http destinations", () => {
    for (const location of ["http://169.254.169.254/latest/meta-data/", "http://localhost:3000/admin", "http://10.0.0.5/", "file:///etc/passwd", "gopher://example.com/", undefined]) {
      assert.throws(() => redirectTarget(location, "https://cdn.example.com/a.mp4"), SourceDownloadError, String(location));
    }
  });
});

describe("player-hls transcription: guarded DNS lookup", () => {
  const lookupWith = (addresses: { address: string; family: number }[]) => {
    const resolve: AddressResolver = async () => addresses;
    return guardedMediaLookup(resolve, (a) => !/^(127\.|10\.|169\.254\.|::1$)/.test(a));
  };
  const call = (lookup: ReturnType<typeof guardedMediaLookup>, all: boolean) =>
    new Promise<{ error: NodeJS.ErrnoException | null; result: unknown }>((resolve) => {
      lookup("media.example.com", { all }, (error: NodeJS.ErrnoException | null, result: unknown) => resolve({ error, result }));
    });

  it("refuses a name when any of its addresses is private", async () => {
    const { error } = await call(lookupWith([{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }]), true);
    assert.ok(error instanceof SourceDownloadError);
  });

  it("hands public addresses to the socket", async () => {
    const { error, result } = await call(lookupWith([{ address: "93.184.216.34", family: 4 }]), true);
    assert.equal(error, null);
    assert.deepEqual(result, [{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("player-hls transcription: source download", () => {
  let server: http.Server;
  let port = 0;
  let dir = "";
  let hits: string[] = [];
  const BODY = Buffer.from("fake video bytes ".repeat(64));

  before(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "ll-ssrf-"));
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/video.mp4") {
        res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": BODY.length });
        res.end(BODY);
      } else if (req.url === "/hop") {
        res.writeHead(302, { Location: "/video.mp4" });
        res.end();
      } else if (req.url === "/to-metadata") {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
      } else if (req.url === "/to-internal-name") {
        res.writeHead(301, { Location: `http://internal.example.com:${port}/video.mp4` });
        res.end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { Location: "/loop" });
        res.end();
      } else if (req.url === "/playlist") {
        res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
        res.end("#EXTM3U\nhttp://169.254.169.254/latest/meta-data/\n");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  // "media.example.com" stands for a public CDN; it is served by the local test server.
  const toLocal: AddressResolver = async (name) => [{ address: "127.0.0.1", family: 4 }].filter(() => name.endsWith("example.com"));
  const url = (p: string) => `http://media.example.com:${port}${p}`;
  const allowLocal = { resolve: toLocal, isAllowedAddress: () => true };

  it("refuses a public-looking name that resolves to a private address, before any request", async () => {
    hits = [];
    const file = path.join(dir, "blocked.media");
    await assert.rejects(downloadPublicMedia(url("/video.mp4"), file, { resolve: toLocal }), (err: Error) => err instanceof SourceDownloadError && /private or reserved/.test(err.message));
    assert.deepEqual(hits, []);
    assert.equal(existsSync(file), false);
  });

  it("downloads a public file and follows a redirect", async () => {
    const file = path.join(dir, "ok.media");
    const result = await downloadPublicMedia(url("/hop"), file, allowLocal);
    assert.equal(result.bytes, BODY.length);
    assert.equal(result.url, url("/video.mp4"));
    assert.deepEqual(readFileSync(file), BODY);
  });

  it("re-checks every redirect hop", async () => {
    await assert.rejects(downloadPublicMedia(url("/to-metadata"), path.join(dir, "r1.media"), allowLocal), /redirected to a private or unsupported address/);
    // A redirect to a name is resolved through the guarded lookup again (here the guard is the default one).
    hits = [];
    let resolved = 0;
    const counting: AddressResolver = async (name) => {
      resolved++;
      return toLocal(name);
    };
    await assert.rejects(
      downloadPublicMedia(url("/to-internal-name"), path.join(dir, "r2.media"), { resolve: counting, isAllowedAddress: (a) => resolved < 2 && a === "127.0.0.1" }),
      /private or reserved/,
    );
    assert.equal(resolved, 2);
    assert.deepEqual(hits, ["/to-internal-name"]);
  });

  it("stops after too many redirects", async () => {
    await assert.rejects(downloadPublicMedia(url("/loop"), path.join(dir, "loop.media"), allowLocal), /too many times/);
  });

  it("refuses streaming playlists and oversized files", async () => {
    await assert.rejects(downloadPublicMedia(url("/playlist"), path.join(dir, "pl.media"), allowLocal), /Streaming playlists cannot be transcribed/);
    await assert.rejects(downloadPublicMedia(url("/video.mp4"), path.join(dir, "big.media"), { ...allowLocal, maxBytes: 100 }), /larger than/);
  });

  it("refuses literal private addresses without connecting", async () => {
    hits = [];
    await assert.rejects(downloadPublicMedia(`http://127.0.0.1:${port}/video.mp4`, path.join(dir, "lit.media"), allowLocal), SourceDownloadError);
    assert.deepEqual(hits, []);
  });

  it("stops when the job is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(downloadPublicMedia(url("/video.mp4"), path.join(dir, "c.media"), { ...allowLocal, signal: controller.signal }), (err: Error) => err.name === "AbortError");
  });
});

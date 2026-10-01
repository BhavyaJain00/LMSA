import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { User } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { buildMasterPlaylist, isPlaylistPath, parseMasterRenditions, parseMediaSegments, resolvePlaylistUri, rewritePlaylist } from "@/lib/media/hls";
import { isHlsPart, signPlaylist } from "@/lib/media/serve";
import { mediaResponseHeaders } from "@/lib/media/files";
import { issueMediaToken, verifyMediaToken } from "@/lib/media/token";
import { MEDIA_TOKEN_PARAM } from "@/lib/media/paths";
import { uploadRoot } from "@/lib/storage";
import { GET, HEAD } from "@/app/uploads/[...path]/route";
import { makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Secure HLS serving: playlist URI rewriting (pure), per-viewer signing of
 * child playlists and segments, content types, Range and caching headers,
 * and the `/uploads/[...path]` route end to end with protection on and off.
 */

const MASTER = "/uploads/videos/les_1/blk_1/hls/v1/master.m3u8";
const MEDIA = "/uploads/videos/les_1/blk_1/hls/v1/720p/index.m3u8";

const MEDIA_PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:6",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-MAP:URI="init.mp4"',
  "#EXTINF:6.000000,",
  "seg_00001.m4s",
  "#EXTINF:3.500000,",
  "seg_00002.m4s",
  "#EXT-X-ENDLIST",
  "",
].join("\r\n");

describe("resolvePlaylistUri", () => {
  it("resolves relative and root-relative URIs inside the playlist folder", () => {
    assert.equal(resolvePlaylistUri("720p/index.m3u8", MASTER), MEDIA);
    assert.equal(resolvePlaylistUri("./720p/index.m3u8", MASTER), MEDIA);
    assert.equal(resolvePlaylistUri(MEDIA, MASTER), MEDIA);
    assert.equal(resolvePlaylistUri("seg_00001.m4s", MEDIA), "/uploads/videos/les_1/blk_1/hls/v1/720p/seg_00001.m4s");
  });

  it("leaves absolute, protocol-relative, data and escaping URIs alone", () => {
    assert.equal(resolvePlaylistUri("https://cdn.example.com/a.m4s", MEDIA), null);
    assert.equal(resolvePlaylistUri("//evil.example/a.m4s", MEDIA), null);
    assert.equal(resolvePlaylistUri("data:video/mp4;base64,AAAA", MEDIA), null);
    assert.equal(resolvePlaylistUri("../../../../other/secret.mp4", MEDIA), null);
    assert.equal(resolvePlaylistUri("../1080p/index.m3u8", MEDIA), null);
    assert.equal(resolvePlaylistUri("", MEDIA), null);
    assert.equal(resolvePlaylistUri("   ", MEDIA), null);
  });

  it("does not hand out the playlist's own folder", () => {
    assert.equal(resolvePlaylistUri("./", MEDIA), null);
  });
});

describe("rewritePlaylist", () => {
  it("rewrites URI lines and URI attributes, keeps comments and tags, normalizes CRLF", () => {
    const out = rewritePlaylist(MEDIA_PLAYLIST, MEDIA, (child) => `${child}?t=x`);
    assert.ok(!out.includes("\r"));
    const lines = out.split("\n");
    assert.ok(lines.includes('#EXT-X-MAP:URI="/uploads/videos/les_1/blk_1/hls/v1/720p/init.mp4?t=x"'));
    assert.ok(lines.includes("/uploads/videos/les_1/blk_1/hls/v1/720p/seg_00001.m4s?t=x"));
    assert.ok(lines.includes("/uploads/videos/les_1/blk_1/hls/v1/720p/seg_00002.m4s?t=x"));
    assert.ok(lines.includes("#EXTINF:6.000000,"));
    assert.ok(lines.includes("#EXT-X-ENDLIST"));
  });

  it("keeps a URI when sign returns null or the URI is foreign", () => {
    const text = "#EXTM3U\n#EXTINF:6,\nhttps://cdn.example.com/x.m4s\n#EXTINF:6,\nseg.m4s\n";
    const out = rewritePlaylist(text, MEDIA, () => null);
    assert.equal(out, text);
    const signed = rewritePlaylist(text, MEDIA, (c) => `${c}?t=1`);
    assert.ok(signed.includes("https://cdn.example.com/x.m4s\n"));
    assert.ok(signed.includes("/720p/seg.m4s?t=1"));
  });

  it("rewrites EXT-X-MEDIA and I-frame URIs but not plain comments", () => {
    const text = '#EXTM3U\n# URI="note.m4s"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/index.m3u8"\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="iframes.m3u8"\n';
    const out = rewritePlaylist(text, MASTER, (c) => `${c}?t=1`);
    assert.ok(out.includes('# URI="note.m4s"'));
    assert.ok(out.includes('URI="/uploads/videos/les_1/blk_1/hls/v1/audio/index.m3u8?t=1"'));
    assert.ok(out.includes('URI="/uploads/videos/les_1/blk_1/hls/v1/iframes.m3u8?t=1"'));
  });
});

describe("signPlaylist", () => {
  it("gives every child a token for the same viewer and path", () => {
    const out = signPlaylist(MEDIA_PLAYLIST, MEDIA, "usr_a", 600);
    const urls = out.split("\n").flatMap((l) => (l.startsWith("/uploads/") ? [l] : (/URI="([^"]+)"/.exec(l)?.slice(1) ?? [])));
    assert.equal(urls.length, 3);
    for (const url of urls) {
      const parsed = new URL(url, "https://lms.test");
      const token = parsed.searchParams.get(MEDIA_TOKEN_PARAM);
      assert.ok(token, url);
      assert.equal(verifyMediaToken(parsed.pathname, "usr_a", token).ok, true);
      const other = verifyMediaToken(parsed.pathname, "usr_b", token);
      assert.equal(other.ok, false);
      // A token is bound to its own file.
      assert.equal(verifyMediaToken(MEDIA, "usr_a", token).ok, false);
    }
  });

  it("signs a repeated URI once", () => {
    const text = "#EXTM3U\n#EXTINF:6,\nseg.m4s\n#EXTINF:6,\nseg.m4s\n";
    const lines = signPlaylist(text, MEDIA, "usr_a", 600).split("\n").filter((l) => l.startsWith("/uploads/"));
    assert.equal(lines.length, 2);
    assert.equal(lines[0], lines[1]);
  });

  it("child tokens expire with the TTL", () => {
    const now = 1_800_000_000;
    const out = signPlaylist("#EXTM3U\n#EXTINF:6,\nseg.m4s\n", MEDIA, "usr_a", 300, now);
    const url = new URL(out.split("\n").find((l) => l.startsWith("/uploads/"))!, "https://lms.test");
    const token = url.searchParams.get(MEDIA_TOKEN_PARAM);
    assert.equal(verifyMediaToken(url.pathname, "usr_a", token, now + 299).ok, true);
    assert.deepEqual(verifyMediaToken(url.pathname, "usr_a", token, now + 301), { ok: false, reason: "expired" });
  });
});

describe("playlist helpers", () => {
  it("detects playlists and HLS parts", () => {
    assert.equal(isPlaylistPath("/uploads/videos/a/hls/v1/master.m3u8?t=1"), true);
    assert.equal(isPlaylistPath("/uploads/videos/a/MASTER.M3U8"), true);
    assert.equal(isPlaylistPath("/uploads/videos/a.mp4"), false);
    assert.equal(isHlsPart("videos/les_1/blk_1/hls/v1/720p/init.mp4"), true);
    assert.equal(isHlsPart("videos/les_1/blk_1/lesson.mp4"), false);
  });

  it("master playlist round-trips through parseMasterRenditions", () => {
    const text = buildMasterPlaylist([
      { uri: "480p/index.m3u8", width: 854, height: 480, bandwidth: 1_400_000, codecs: "avc1.64001e,mp4a.40.2" },
      { uri: "1080p/index.m3u8", width: 1920, height: 1080, bandwidth: 5_000_000, averageBandwidth: 4_200_000, codecs: "avc1.640028,mp4a.40.2", frameRate: 30 },
    ]);
    assert.ok(text.startsWith("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n"));
    assert.ok(text.includes('#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=4200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=30.000'));
    assert.deepEqual(parseMasterRenditions(text), [
      { height: 1080, bandwidth: 5_000_000, uri: "1080p/index.m3u8" },
      { height: 480, bandwidth: 1_400_000, uri: "480p/index.m3u8" },
    ]);
  });

  it("parses media segments, the init segment and the total duration", () => {
    const info = parseMediaSegments(MEDIA_PLAYLIST);
    assert.equal(info.initUri, "init.mp4");
    assert.equal(info.targetDuration, 6);
    assert.equal(info.segments.length, 2);
    assert.equal(info.totalDuration, 9.5);
    assert.equal(info.endList, true);
  });
});

describe("mediaResponseHeaders", () => {
  const signed = { signed: true, videoDir: true };
  it("serves the right content types", () => {
    assert.equal(mediaResponseHeaders({ ext: ".m3u8" }, signed)["Content-Type"], "application/vnd.apple.mpegurl");
    assert.equal(mediaResponseHeaders({ ext: ".m4s" }, signed)["Content-Type"], "video/iso.segment");
    assert.equal(mediaResponseHeaders({ ext: ".mp4", hlsPart: true }, signed)["Content-Type"], "video/mp4");
    assert.equal(mediaResponseHeaders({ ext: ".ts" }, signed)["Content-Type"], "video/mp2t");
  });

  it("caches signed segments privately and never caches signed playlists or MP4s publicly", () => {
    assert.equal(mediaResponseHeaders({ ext: ".m4s" }, signed)["Cache-Control"], "private, max-age=3600");
    assert.equal(mediaResponseHeaders({ ext: ".mp4", hlsPart: true }, signed)["Cache-Control"], "private, max-age=3600");
    assert.equal(mediaResponseHeaders({ ext: ".mp4" }, signed)["Cache-Control"], "private, no-store");
    assert.equal(mediaResponseHeaders({ ext: ".m3u8" }, signed)["Cache-Control"], "private, no-store");
    assert.equal(mediaResponseHeaders({ ext: ".m4s" }, { signed: false, videoDir: true })["Cache-Control"], "private, max-age=3600");
    assert.equal(mediaResponseHeaders({ ext: ".png" }, { signed: false, videoDir: false })["Cache-Control"], "public, max-age=31536000, immutable");
  });

  it("always advertises Range support and nosniff", () => {
    const h = mediaResponseHeaders({ ext: ".m4s" }, signed);
    assert.equal(h["Accept-Ranges"], "bytes");
    assert.equal(h["X-Content-Type-Options"], "nosniff");
  });
});

/* ------------------------------------------------------------------ */
/* The /uploads route                                                   */
/* ------------------------------------------------------------------ */

describe("/uploads/[...path] serving HLS", () => {
  const hlsDir = () => path.join(uploadRoot(), "videos", "les_1", "blk_1", "hls", "v1");
  const segment = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  let alice: User;
  let bob: User;

  function writeStream() {
    rmSync(path.join(uploadRoot(), "videos"), { recursive: true, force: true });
    mkdirSync(path.join(hlsDir(), "720p"), { recursive: true });
    writeFileSync(
      path.join(hlsDir(), "master.m3u8"),
      buildMasterPlaylist([{ uri: "720p/index.m3u8", width: 1280, height: 720, bandwidth: 2_800_000, codecs: "avc1.64001f,mp4a.40.2" }]),
    );
    writeFileSync(path.join(hlsDir(), "720p", "index.m3u8"), MEDIA_PLAYLIST);
    writeFileSync(path.join(hlsDir(), "720p", "init.mp4"), Buffer.from("init-segment"));
    writeFileSync(path.join(hlsDir(), "720p", "seg_00001.m4s"), segment);
    writeFileSync(path.join(hlsDir(), "720p", "seg_00002.m4s"), segment.subarray(0, 400));
  }

  async function as(user: User | null) {
    resetRequest();
    if (user) await createSession(user.id);
  }

  function call(url: string, init: { headers?: Record<string, string>; head?: boolean } = {}) {
    const full = new URL(url, "https://lms.test");
    const req = Object.assign(new Request(full, { method: init.head ? "HEAD" : "GET", headers: init.headers ?? {} }), { nextUrl: full }) as unknown as NextRequest;
    const parts = full.pathname.replace(/^\/uploads\//, "").split("/").map(decodeURIComponent);
    const ctx = { params: Promise.resolve({ path: parts }) } as unknown as RouteContext<"/uploads/[...path]">;
    return init.head ? HEAD(req, ctx) : GET(req, ctx);
  }

  const signedUrl = (p: string, subject: string) => `${p}?${MEDIA_TOKEN_PARAM}=${encodeURIComponent(issueMediaToken(p, subject, 600).token)}`;
  const childUrls = (text: string) => text.split("\n").flatMap((l) => (l.startsWith("/uploads/") ? [l] : (/URI="([^"]+)"/.exec(l)?.slice(1) ?? [])));

  beforeEach(async () => {
    alice = makeUser({ id: "usr_alice", email: "alice@example.com" });
    bob = makeUser({ id: "usr_bob", email: "bob@example.com" });
    await resetDb({ users: [alice, bob], settings: { video: { protectUploads: true } } });
    writeStream();
  });

  it("rejects playlists and segments without a token", async () => {
    await as(alice);
    const res = await call(MASTER);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("X-Media-Token"), "missing");
    assert.equal((await call(MEDIA)).status, 403);
  });

  it("serves a signed master with signed child URLs for the same viewer", async () => {
    await as(alice);
    const res = await call(signedUrl(MASTER, alice.id));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "application/vnd.apple.mpegurl");
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const text = await res.text();
    assert.equal(Number(res.headers.get("Content-Length")), Buffer.byteLength(text));
    const [child] = childUrls(text);
    assert.ok(child?.startsWith(`${MEDIA}?${MEDIA_TOKEN_PARAM}=`), text);

    // The media playlist opens with its rewritten token and signs its own children.
    const media = await call(child!);
    assert.equal(media.status, 200);
    const mediaText = await media.text();
    const segments = childUrls(mediaText);
    assert.equal(segments.length, 3);
    assert.ok(segments.every((u) => u.includes(`?${MEDIA_TOKEN_PARAM}=`)));

    const init = await call(segments.find((u) => u.includes("init.mp4"))!);
    assert.equal(init.status, 200);
    assert.equal(init.headers.get("Content-Type"), "video/mp4");
    assert.equal(init.headers.get("Cache-Control"), "private, max-age=3600");
    assert.equal(await init.text(), "init-segment");

    const seg = await call(segments.find((u) => u.includes("seg_00001"))!);
    assert.equal(seg.status, 200);
    assert.equal(seg.headers.get("Content-Type"), "video/iso.segment");
    assert.equal(seg.headers.get("Cache-Control"), "private, max-age=3600");
    assert.equal(seg.headers.get("Accept-Ranges"), "bytes");
    assert.deepEqual(Buffer.from(await seg.arrayBuffer()), segment);
  });

  it("does not let another viewer reuse a copied playlist", async () => {
    await as(alice);
    const text = await (await call(signedUrl(MASTER, alice.id))).text();
    const [child] = childUrls(text);
    await as(bob);
    const res = await call(child!);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("X-Media-Token"), "invalid");
    // Bob's own master link works and gives him his own child tokens.
    const own = await (await call(signedUrl(MASTER, bob.id))).text();
    assert.notEqual(childUrls(own)[0], child);
    assert.equal((await call(childUrls(own)[0]!)).status, 200);
  });

  it("answers Range requests on segments with 206 and 416", async () => {
    await as(alice);
    const url = signedUrl("/uploads/videos/les_1/blk_1/hls/v1/720p/seg_00001.m4s", alice.id);
    const part = await call(url, { headers: { range: "bytes=100-199" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("Content-Range"), "bytes 100-199/1000");
    assert.equal(part.headers.get("Content-Length"), "100");
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), segment.subarray(100, 200));

    const suffix = await call(url, { headers: { range: "bytes=-10" } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get("Content-Range"), "bytes 990-999/1000");

    const bad = await call(url, { headers: { range: "bytes=5000-6000" } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get("Content-Range"), "bytes */1000");

    const head = await call(url, { head: true });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("Content-Length"), "1000");
    assert.equal(await head.text(), "");
  });

  it("sends playlists whole even when a Range is asked for", async () => {
    await as(alice);
    const res = await call(signedUrl(MASTER, alice.id), { headers: { range: "bytes=0-9" } });
    assert.equal(res.status, 200);
    assert.ok((await res.text()).startsWith("#EXTM3U"));
  });

  it("serves streams unchanged and without tokens while protection is off", async () => {
    await resetDb({ users: [alice], settings: { video: { protectUploads: false } } });
    await as(null);
    const res = await call(MASTER);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, max-age=3600");
    const text = await res.text();
    assert.ok(text.includes("\n720p/index.m3u8"), text);
    assert.ok(!text.includes(`?${MEDIA_TOKEN_PARAM}=`));
  });

  it("returns 404 for missing streams once the token checks out", async () => {
    await as(alice);
    const p = "/uploads/videos/les_1/blk_1/hls/v9/master.m3u8";
    assert.equal((await call(signedUrl(p, alice.id))).status, 404);
    // Without a valid token nobody learns whether the file exists.
    assert.equal((await call(p)).status, 403);
  });

  it("checks letter-case aliases of the video folder against the real path", async () => {
    await as(alice);
    const alias = "/uploads/VIDEOS/les_1/blk_1/hls/v1/master.m3u8";
    assert.equal((await call(alias)).status, 403);
    const signedAlias = await call(signedUrl(alias, alice.id));
    // Case-sensitive file systems: not found. Case-insensitive ones: served, with children signed for the real path.
    assert.ok([200, 403, 404].includes(signedAlias.status));
    if (signedAlias.status === 200) {
      const text = await signedAlias.text();
      assert.ok(childUrls(text).every((u) => u.startsWith("/uploads/videos/")));
    }
  });
});

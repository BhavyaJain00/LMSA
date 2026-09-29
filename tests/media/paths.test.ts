import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMediaPath,
  encodeMediaPath,
  isProtectedVideoPath,
  mediaTokenExpiry,
  parseMediaSrc,
  sameMediaSource,
  splitMediaToken,
  stripMediaToken,
  withMediaToken,
} from "@/lib/media/paths";
import { lessonReferencesPath, lessonVideoSrcs, uploadPathOf } from "@/lib/media/access";
import type { LessonBlock } from "@/lib/types";

const TOKEN = `1780000000.${"a".repeat(43)}`;

describe("canonicalMediaPath", () => {
  it("decodes segments", () => {
    assert.equal(canonicalMediaPath("/uploads/videos/intro%20clip.mp4"), "/uploads/videos/intro clip.mp4");
    assert.equal(canonicalMediaPath("/uploads/"), "/uploads/");
    assert.equal(canonicalMediaPath("/"), "/");
  });

  it("rejects traversal and smuggled separators", () => {
    for (const bad of [
      "/uploads/../storage/db.json",
      "/uploads/%2e%2e/db.json",
      "/uploads/./videos/x.mp4",
      "/uploads/videos%2F..%2Fdb.json",
      "/uploads/videos/..%5Cdb.json",
      "/uploads/videos/x%00.mp4",
      "/uploads//videos/x.mp4",
      "/uploads/%E0%A4%A",
      "uploads/videos/x.mp4",
    ]) {
      assert.equal(canonicalMediaPath(bad), null, bad);
    }
  });

  it("re-encodes paths for URLs", () => {
    assert.equal(encodeMediaPath("/uploads/videos/intro clip #1.mp4"), "/uploads/videos/intro%20clip%20%231.mp4");
    assert.equal(canonicalMediaPath(encodeMediaPath("/uploads/videos/ünï ✓.mp4")), "/uploads/videos/ünï ✓.mp4");
  });
});

describe("parseMediaSrc", () => {
  it("parses relative uploads and extracts the token", () => {
    assert.deepEqual(parseMediaSrc(`/uploads/videos/a%20b.mp4?t=${TOKEN}&x=1`), {
      path: "/uploads/videos/a b.mp4",
      token: TOKEN,
      isUpload: true,
      isProtectedVideo: true,
    });
    assert.deepEqual(parseMediaSrc("/uploads/images/cover.png"), { path: "/uploads/images/cover.png", token: null, isUpload: true, isProtectedVideo: false });
    assert.equal(parseMediaSrc("/uploads/videos/")?.isProtectedVideo, false);
    assert.equal(parseMediaSrc("/uploads/")?.isUpload, false);
    assert.equal(parseMediaSrc("/courses/x")?.isUpload, false);
  });

  it("accepts absolute URLs only from this site's origins", () => {
    const origins = ["https://LMS.example.com", "not a url"];
    assert.equal(parseMediaSrc("https://lms.example.com/uploads/videos/x.mp4", origins)?.isProtectedVideo, true);
    assert.equal(parseMediaSrc("https://evil.example.com/uploads/videos/x.mp4", origins), null);
    assert.equal(parseMediaSrc("https://lms.example.com/uploads/videos/x.mp4"), null);
    assert.equal(parseMediaSrc("//lms.example.com/uploads/videos/x.mp4", origins), null);
    assert.equal(parseMediaSrc("https://lms.example.com:8443/uploads/videos/x.mp4", origins), null);
  });

  it("rejects empty and malformed sources", () => {
    for (const bad of ["", "   ", "/uploads/videos/x%00.mp4", "/uploads/%E0%A4%A", "https://[bad", "javascript:alert(1)"]) {
      assert.equal(parseMediaSrc(bad, ["https://lms.example.com"]), null, bad);
    }
  });

  it("never lets dot segments reach into the upload directory from outside", () => {
    // The URL parser resolves "..": what remains is not an upload path.
    assert.deepEqual(parseMediaSrc("/uploads/videos/../../storage/db.json"), { path: "/storage/db.json", token: null, isUpload: false, isProtectedVideo: false });
    assert.equal(parseMediaSrc("/uploads/videos/%2e%2e/%2e%2e/storage/db.json")?.isUpload, false);
  });
});

describe("token helpers", () => {
  it("adds, strips and reads tokens", () => {
    const signed = withMediaToken("/uploads/videos/a b.mp4", TOKEN);
    assert.equal(signed, `/uploads/videos/a%20b.mp4?t=${TOKEN}`);
    assert.equal(stripMediaToken(signed), "/uploads/videos/a%20b.mp4");
    assert.equal(stripMediaToken(`/v.mp4?x=1&t=${TOKEN}&y=2#t=10`), "/v.mp4?x=1&y=2#t=10");
    assert.equal(stripMediaToken("  /v.mp4  "), "/v.mp4");
    assert.equal(mediaTokenExpiry(signed), 1780000000);
    assert.equal(mediaTokenExpiry("/v.mp4?t=garbage"), null);
    assert.equal(mediaTokenExpiry("/v.mp4"), null);
  });

  it("splits well-formed tokens only", () => {
    assert.deepEqual(splitMediaToken(TOKEN), { expires: 1780000000, signature: "a".repeat(43) });
    for (const bad of [null, "", "1780000000", `1780000000.${"a".repeat(44)}`, `17800000000000.${"a".repeat(43)}`]) assert.equal(splitMediaToken(bad), null, String(bad));
  });

  it("compares sources ignoring tokens and same-site origins", () => {
    const origins = ["https://lms.example.com"];
    assert.equal(sameMediaSource(`/uploads/videos/x.mp4?t=${TOKEN}`, "https://lms.example.com/uploads/videos/x.mp4", origins), true);
    assert.equal(sameMediaSource("/uploads/videos/x.mp4", "/uploads/videos/y.mp4"), false);
    assert.equal(sameMediaSource("https://cdn.example.net/v.mp4?t=1", "https://cdn.example.net/v.mp4"), true);
    assert.equal(sameMediaSource(null, "/x"), false);
    assert.equal(isProtectedVideoPath("/uploads/videos/x.mp4"), true);
    assert.equal(isProtectedVideoPath("/uploads/videos/"), false);
  });
});

describe("lesson video references", () => {
  const blocks: LessonBlock[] = [
    { id: "b1", type: "video", src: "/uploads/videos/main.mp4", sources: [{ src: "http://localhost:3000/uploads/videos/main-480.mp4", label: "480p" }] },
    { id: "b2", type: "markdown", content: "/uploads/videos/not-a-video-block.mp4" },
    { id: "b3", type: "video", src: "https://cdn.example.net/external.mp4" },
  ];

  it("lists every video source of a lesson", () => {
    assert.deepEqual(lessonVideoSrcs({ blocks }), ["/uploads/videos/main.mp4", "http://localhost:3000/uploads/videos/main-480.mp4", "https://cdn.example.net/external.mp4"]);
  });

  it("matches canonical upload paths (including extra qualities on this site)", () => {
    assert.equal(lessonReferencesPath({ blocks }, "/uploads/videos/main.mp4"), true);
    assert.equal(lessonReferencesPath({ blocks }, "/uploads/videos/main-480.mp4"), true);
    assert.equal(lessonReferencesPath({ blocks }, "/uploads/videos/not-a-video-block.mp4"), false);
    assert.equal(uploadPathOf("https://cdn.example.net/uploads/videos/x.mp4"), null);
    assert.equal(uploadPathOf(undefined), null);
  });
});

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isProtectedVideoPath,
  isSafeUploadSegment,
  mediaPathKey,
  parseMediaSrc,
  parseUploadRequestPath,
  sameMediaSource,
} from "@/lib/media/paths";
import { resolveUploadAccess, uploadResponseHeaders, type UploadAccess } from "@/lib/media/files";
import { computeMediaSignature, createMediaToken, verifyMediaToken } from "@/lib/media/token";

/** Secure-video review, finding 1: case / NTFS stream variants of the protected folder. */

const SECRET = "secure-video-test-secret-0123456789abcdef";
const NOW = 1_780_000_000;
const VIDEO = "/uploads/videos/intro-abc.mp4";
const token = (p: string, subject = "usr_ada", expires = NOW + 600) => createMediaToken(p, subject, expires, SECRET);

let root: string;
let caseInsensitiveFs = false;
let symlinked = false;

before(() => {
  root = path.join(mkdtempSync(path.join(tmpdir(), "ll-sv-files-")), "uploads");
  mkdirSync(path.join(root, "videos"), { recursive: true });
  writeFileSync(path.join(root, "videos", "intro-abc.mp4"), Buffer.from("00000000ftypisom-video-bytes"));
  writeFileSync(path.join(root, "cover-xyz.png"), Buffer.from("png-bytes"));
  caseInsensitiveFs = existsSync(path.join(root, "VIDEOS", "INTRO-ABC.MP4"));
  try {
    // A directory alias of the video folder (a junction needs no privileges on Windows).
    symlinkSync(path.join(root, "videos"), path.join(root, "alias"), "junction");
    symlinked = true;
  } catch {
    symlinked = false;
  }
});

after(() => rmSync(path.dirname(root), { recursive: true, force: true }));

function access(parts: string[], opts: { token?: string | null; protect?: boolean; subject?: string } = {}): Promise<UploadAccess> {
  return resolveUploadAccess(parts, {
    root,
    token: opts.token ?? null,
    protectUploads: async () => opts.protect ?? true,
    subject: async () => opts.subject ?? "usr_ada",
    now: NOW,
    secret: SECRET,
  });
}

describe("upload path segments", () => {
  it("rejects NTFS streams, device names, trailing dots/spaces, separators and dot-files", () => {
    for (const bad of [
      "videos::$INDEX_ALLOCATION",
      "videos:$I30:$INDEX_ALLOCATION",
      "intro.mp4::$DATA",
      "C:",
      "videos.",
      "videos ",
      "CON",
      "nul.mp4",
      "COM1",
      "lpt9.txt",
      "conin$",
      "a/b",
      "a\\b",
      "x\0.mp4",
      "..",
      ".",
      ".app-secret",
      ".intro.mp4.part",
      "a|b",
      "a*b",
      "",
    ]) {
      assert.equal(isSafeUploadSegment(bad), false, JSON.stringify(bad));
    }
    for (const good of ["videos", "intro-abc.mp4", "intro clip.mp4", "ünï.png", "console.log.txt", "nullable.pdf"]) assert.equal(isSafeUploadSegment(good), true, good);
  });

  it("parses request paths and recognises the video folder in any case", () => {
    assert.deepEqual(parseUploadRequestPath(["videos", "intro-abc.mp4"]), { name: "videos/intro-abc.mp4", path: VIDEO, inVideoDir: true });
    for (const variant of ["Videos", "VIDEOS", "vIdEoS"]) assert.equal(parseUploadRequestPath([variant, "intro-abc.mp4"])?.inVideoDir, true, variant);
    assert.equal(parseUploadRequestPath(["cover-xyz.png"])?.inVideoDir, false);
    assert.equal(parseUploadRequestPath(["videos::$INDEX_ALLOCATION", "intro-abc.mp4"]), null);
    assert.equal(parseUploadRequestPath(["videos/intro-abc.mp4"]), null); // an encoded %2F decoded by the router
    assert.equal(parseUploadRequestPath([]), null);
  });

  it("folds case for signing and matching", () => {
    assert.equal(mediaPathKey("/uploads/Videos/INTRO-ABC.MP4"), VIDEO);
    assert.equal(mediaPathKey(VIDEO), VIDEO);
    assert.equal(isProtectedVideoPath("/uploads/VIDEOS/intro-abc.mp4"), true);
    assert.equal(parseMediaSrc("/uploads/Videos/INTRO-ABC.MP4")?.isProtectedVideo, true);
    assert.equal(parseMediaSrc("/uploads/videos::$INDEX_ALLOCATION/intro-abc.mp4")?.isUpload, false);
    assert.equal(sameMediaSource("/uploads/Videos/INTRO-ABC.MP4", `${VIDEO}?t=${NOW}.${"a".repeat(43)}`), true);
    // One signature for every spelling of the same file.
    assert.equal(computeMediaSignature("/uploads/VIDEOS/Intro-ABC.mp4", "usr_ada", NOW, SECRET), computeMediaSignature(VIDEO, "usr_ada", NOW, SECRET));
    assert.equal(verifyMediaToken("/uploads/Videos/intro-abc.mp4", "usr_ada", token(VIDEO), NOW, SECRET).ok, true);
  });
});

describe("resolveUploadAccess", () => {
  it("serves the protected video with a valid token, privately", async () => {
    const res = await access(["videos", "intro-abc.mp4"], { token: token(VIDEO) });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.signed, true);
    assert.equal(res.file.inVideoDir, true);
    assert.equal(uploadResponseHeaders(res.file, res)["Cache-Control"], "private, no-store");
  });

  it("requires the token for case variants of the folder and file (before touching the disk)", async () => {
    for (const parts of [
      ["Videos", "intro-abc.mp4"],
      ["VIDEOS", "INTRO-ABC.MP4"],
      ["videos", "INTRO-ABC.mp4"],
      ["Videos", "does-not-exist.mp4"],
    ]) {
      const res = await access(parts);
      assert.deepEqual(res, { ok: false, status: 403, reason: "missing" }, parts.join("/"));
    }
    // A token for another viewer does not help either.
    assert.deepEqual(await access(["Videos", "intro-abc.mp4"], { token: token(VIDEO, "usr_bob") }), { ok: false, status: 403, reason: "invalid" });
  });

  it("treats a case variant with a valid token as the same, still private file", async () => {
    const res = await access(["VIDEOS", "Intro-Abc.MP4"], { token: token(VIDEO) });
    if (!caseInsensitiveFs) {
      assert.deepEqual(res, { ok: false, status: 404 });
      return;
    }
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.signed, true);
    assert.equal(res.file.canonicalPath?.toLowerCase(), VIDEO);
    assert.notEqual(uploadResponseHeaders(res.file, res)["Cache-Control"], "public, max-age=31536000, immutable");
  });

  it("rejects NTFS stream syntax, trailing dots and encoded separators", async () => {
    for (const parts of [
      ["videos::$INDEX_ALLOCATION", "intro-abc.mp4"],
      ["videos:$I30:$INDEX_ALLOCATION", "intro-abc.mp4"],
      ["videos", "intro-abc.mp4::$DATA"],
      ["videos.", "intro-abc.mp4"],
      ["videos ", "intro-abc.mp4"],
      ["videos/intro-abc.mp4"],
      ["videos\\intro-abc.mp4"],
      ["..", "db.json"],
      ["videos", "..", "cover-xyz.png"],
      [".app-secret"],
      ["NUL"],
    ]) {
      assert.deepEqual(await access(parts, { token: token(VIDEO) }), { ok: false, status: 404 }, parts.join("/"));
    }
  });

  it("decides protection from the real location: aliases of the folder need a token for the real file", async (t) => {
    if (!symlinked) {
      t.skip("symbolic links are not available here");
      return;
    }
    assert.deepEqual(await access(["alias", "intro-abc.mp4"]), { ok: false, status: 403, reason: "missing" });
    // A token issued for the alias path (e.g. an "unreferenced" staff signature) is not a token for the real file.
    assert.deepEqual(await access(["alias", "intro-abc.mp4"], { token: token("/uploads/alias/intro-abc.mp4") }), { ok: false, status: 403, reason: "invalid" });
    const ok = await access(["alias", "intro-abc.mp4"], { token: token(VIDEO) });
    assert.equal(ok.ok && ok.signed, true);
  });

  it("never serves anything in the video folder as public/immutable, even with protection off", async () => {
    const res = await access(["videos", "intro-abc.mp4"], { protect: false });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.signed, false);
    assert.equal(res.videoDir, true);
    assert.equal(uploadResponseHeaders(res.file, res)["Cache-Control"], "private, max-age=3600");
    if (caseInsensitiveFs) {
      const variant = await access(["Videos", "intro-abc.mp4"], { protect: false });
      assert.equal(variant.ok && uploadResponseHeaders(variant.file, variant)["Cache-Control"], "private, max-age=3600");
    }
    if (symlinked) {
      const alias = await access(["alias", "intro-abc.mp4"], { protect: false });
      assert.equal(alias.ok && uploadResponseHeaders(alias.file, alias)["Cache-Control"], "private, max-age=3600");
    }
  });

  it("keeps other uploads public and needs no session for them", async () => {
    let asked = false;
    const res = await resolveUploadAccess(["cover-xyz.png"], {
      root,
      token: null,
      protectUploads: async () => true,
      subject: async () => {
        asked = true;
        return "guest";
      },
      now: NOW,
      secret: SECRET,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(asked, false);
    assert.equal(uploadResponseHeaders(res.file, res)["Cache-Control"], "public, max-age=31536000, immutable");
    assert.deepEqual(await access(["missing.png"]), { ok: false, status: 404 });
  });
});

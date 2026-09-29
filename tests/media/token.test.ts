import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  MAX_MEDIA_TOKEN_SECONDS,
  computeMediaSignature,
  createMediaToken,
  issueMediaToken,
  mediaSubject,
  verifyMediaToken,
} from "@/lib/media/token";

const SECRET = "media-secret-for-tests-0123456789abcdef";
const PATH = "/uploads/videos/intro-abc.mp4";
const NOW = 1_780_000_000;

describe("media URL signing", () => {
  it("signs path|subject|expires with HMAC-SHA256 (base64url)", () => {
    const expected = createHmac("sha256", SECRET).update(`${PATH}|usr_ada|${NOW + 60}`).digest("base64url");
    assert.equal(computeMediaSignature(PATH, "usr_ada", NOW + 60, SECRET), expected);
    assert.equal(createMediaToken(PATH, "usr_ada", NOW + 60, SECRET), `${NOW + 60}.${expected}`);
  });

  it("refuses invalid expiry values", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_VALUE]) assert.throws(() => createMediaToken(PATH, "usr_ada", bad, SECRET), /expiry/);
  });

  it("uses the viewer id, or 'guest' for signed-out visitors", () => {
    assert.equal(mediaSubject({ id: "usr_ada" }), "usr_ada");
    assert.equal(mediaSubject(null), "guest");
    assert.equal(mediaSubject(undefined), "guest");
  });
});

describe("verifyMediaToken", () => {
  const token = createMediaToken(PATH, "usr_ada", NOW + 600, SECRET);

  it("accepts a valid token until it expires", () => {
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", token, NOW, SECRET), { ok: true, expires: NOW + 600 });
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", token, NOW + 600, SECRET), { ok: true, expires: NOW + 600 });
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", token, NOW + 601, SECRET), { ok: false, reason: "expired" });
  });

  it("binds the token to the viewer (a copied link does not play for someone else)", () => {
    assert.deepEqual(verifyMediaToken(PATH, "usr_bob", token, NOW, SECRET), { ok: false, reason: "invalid" });
    assert.deepEqual(verifyMediaToken(PATH, "guest", token, NOW, SECRET), { ok: false, reason: "invalid" });
  });

  it("binds the token to the file and the secret", () => {
    assert.deepEqual(verifyMediaToken("/uploads/videos/other.mp4", "usr_ada", token, NOW, SECRET), { ok: false, reason: "invalid" });
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", token, NOW, `${SECRET}-rotated`), { ok: false, reason: "invalid" });
  });

  it("rejects tampered signatures and extended expiries", () => {
    const [expires, sig] = token.split(".") as [string, string];
    const flipped = `${expires}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", flipped, NOW, SECRET), { ok: false, reason: "invalid" });
    const extended = `${Number(expires) + 3600}.${sig}`;
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", extended, NOW, SECRET), { ok: false, reason: "invalid" });
  });

  it("reports a bad signature before a stale expiry", () => {
    const stale = createMediaToken(PATH, "usr_ada", NOW - 10, SECRET);
    assert.deepEqual(verifyMediaToken(PATH, "usr_bob", stale, NOW, SECRET), { ok: false, reason: "invalid" });
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", stale, NOW, SECRET), { ok: false, reason: "expired" });
  });

  it("rejects tokens that expire too far in the future", () => {
    const far = createMediaToken(PATH, "usr_ada", NOW + MAX_MEDIA_TOKEN_SECONDS + 120, SECRET);
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", far, NOW, SECRET), { ok: false, reason: "invalid" });
    const withinSkew = createMediaToken(PATH, "usr_ada", NOW + MAX_MEDIA_TOKEN_SECONDS + 30, SECRET);
    assert.equal(verifyMediaToken(PATH, "usr_ada", withinSkew, NOW, SECRET).ok, true);
  });

  it("classifies missing and malformed tokens", () => {
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", null, NOW, SECRET), { ok: false, reason: "missing" });
    assert.deepEqual(verifyMediaToken(PATH, "usr_ada", "", NOW, SECRET), { ok: false, reason: "missing" });
    for (const bad of ["123.abc", `${NOW}`, `${NOW}.${"a".repeat(42)}`, `12345678.${"a".repeat(43)}`, `${NOW}.${"a".repeat(43)}=`, `x${token}`]) {
      assert.deepEqual(verifyMediaToken(PATH, "usr_ada", bad, NOW, SECRET), { ok: false, reason: "malformed" }, bad);
    }
  });
});

describe("issueMediaToken", () => {
  it("issues tokens with a clamped lifetime, signed with APP_SECRET", () => {
    const issued = issueMediaToken(PATH, "usr_ada", 3600, NOW);
    assert.equal(issued.expires, NOW + 3600);
    assert.equal(verifyMediaToken(PATH, "usr_ada", issued.token, NOW, process.env.APP_SECRET).ok, true);
    assert.equal(verifyMediaToken(PATH, "usr_ada", issued.token, NOW).ok, true);
    assert.equal(issueMediaToken(PATH, "guest", 0, NOW).expires, NOW + 1);
    assert.equal(issueMediaToken(PATH, "guest", 10 ** 9, NOW).expires, NOW + MAX_MEDIA_TOKEN_SECONDS);
  });
});

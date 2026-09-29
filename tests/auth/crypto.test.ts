import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decryptString, deriveKey, encryptString, hmacHex, randomToken, safeEqual, sha256Hex } from "@/lib/auth/crypto";

const SECRET_A = "a".repeat(32) + "-secret-for-tests";
const SECRET_B = "b".repeat(32) + "-another-secret";

/** Flip one character of a base64url part without changing its length. */
function tamperPart(payload: string, index: number): string {
  const parts = payload.split(".");
  const part = parts[index]!;
  const flipped = part[0] === "A" ? "B" : "A";
  parts[index] = flipped + part.slice(1);
  return parts.join(".");
}

describe("sha256Hex / randomToken / safeEqual", () => {
  it("hashes like SHA-256", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("creates 256-bit url-safe tokens", () => {
    const token = randomToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(token, randomToken());
    assert.match(randomToken(16), /^[A-Za-z0-9_-]{22}$/);
  });

  it("compares strings exactly", () => {
    assert.equal(safeEqual("secret", "secret"), true);
    assert.equal(safeEqual("", ""), true);
    assert.equal(safeEqual("secret", "Secret"), false);
    assert.equal(safeEqual("secret", "secret "), false);
    assert.equal(safeEqual("a", ""), false);
  });
});

describe("deriveKey / hmacHex", () => {
  it("derives stable 32-byte keys per purpose and secret", () => {
    const key = deriveKey("purpose", SECRET_A);
    assert.equal(key.length, 32);
    assert.deepEqual(deriveKey("purpose", SECRET_A), key);
    assert.notDeepEqual(deriveKey("other", SECRET_A), key);
    assert.notDeepEqual(deriveKey("purpose", SECRET_B), key);
  });

  it("refuses short secrets", () => {
    assert.throws(() => deriveKey("purpose", "too-short"), /32\+ character/);
  });

  it("uses APP_SECRET by default", () => {
    assert.deepEqual(deriveKey("purpose"), deriveKey("purpose", process.env.APP_SECRET));
  });

  it("separates HMACs by purpose", () => {
    const mac = hmacHex("recovery-code", "abcde12345", SECRET_A);
    assert.match(mac, /^[0-9a-f]{64}$/);
    assert.equal(hmacHex("recovery-code", "abcde12345", SECRET_A), mac);
    assert.notEqual(hmacHex("other-purpose", "abcde12345", SECRET_A), mac);
    assert.notEqual(hmacHex("recovery-code", "abcde12345", SECRET_B), mac);
  });
});

describe("AES-256-GCM encryptString / decryptString", () => {
  it("round-trips UTF-8 text", () => {
    for (const plain of ["JBSWY3DPEHPK3PXP", "", "ünïcødé ✓ 日本語 🚀", "x".repeat(5000)]) {
      const sealed = encryptString(plain, "totp-secret", SECRET_A);
      assert.equal(decryptString(sealed, "totp-secret", SECRET_A), plain);
    }
  });

  it("uses the v1.<iv>.<tag>.<ciphertext> format with a fresh IV each time", () => {
    const a = encryptString("same input", "totp-secret", SECRET_A);
    const b = encryptString("same input", "totp-secret", SECRET_A);
    assert.match(a, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    assert.notEqual(a, b);
    assert.ok(!a.includes("same input"));
  });

  it("works with the default APP_SECRET", () => {
    assert.equal(decryptString(encryptString("hello", "p"), "p"), "hello");
  });

  it("fails closed for the wrong purpose or secret", () => {
    const sealed = encryptString("hello", "totp-secret", SECRET_A);
    assert.equal(decryptString(sealed, "calendar", SECRET_A), null);
    assert.equal(decryptString(sealed, "totp-secret", SECRET_B), null);
  });

  it("fails closed for tampered payloads", () => {
    const sealed = encryptString("hello world", "totp-secret", SECRET_A);
    for (const index of [1, 2, 3]) assert.equal(decryptString(tamperPart(sealed, index), "totp-secret", SECRET_A), null, `part ${index}`);
  });

  it("fails closed for malformed payloads", () => {
    const sealed = encryptString("hello", "p", SECRET_A);
    const [, iv, tag, ct] = sealed.split(".");
    for (const bad of [null, undefined, "", "v1", `v2.${iv}.${tag}.${ct}`, `v1.${iv}.${tag}`, `v1.${iv}.${tag}.${ct}.x`, `v1.AAAA.${tag}.${ct}`, `v1.${iv}.AAAA.${ct}`]) {
      assert.equal(decryptString(bad, "p", SECRET_A), null, String(bad));
    }
  });
});

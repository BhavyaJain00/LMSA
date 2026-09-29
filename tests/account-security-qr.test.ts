import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QR_MAX_VERSION, byteCapacity, chooseVersion, encodeQr, tryEncodeQr, utf8Bytes } from "@/lib/qr";
import { buildOtpauthUri } from "@/lib/auth/totp";
import { decodeQrMatrix } from "./helpers/qr-decoder";

/**
 * Authenticator setup must never fail because the otpauth URI is long: the
 * encoder covers every QR version (1–40) and the URI itself is kept short.
 */

describe("long payloads", () => {
  it("encodes and decodes payloads of 300+ bytes (beyond the old version-10 limit)", () => {
    for (const length of [214, 300, 512, 1000, 2331]) {
      const text = `otpauth://totp/${"x".repeat(length - 15)}`;
      assert.equal(utf8Bytes(text).length, length);
      const qr = encodeQr(text);
      assert.equal(qr.version, chooseVersion(length, "M"));
      assert.ok(qr.version > 10);
      assert.equal(decodeQrMatrix(qr.modules).text, text, `${length} bytes`);
    }
  });

  it("encodes long multi-byte (UTF-8) text", () => {
    const text = "Académie de Formation Professionnelle — ".repeat(10);
    assert.ok(utf8Bytes(text).length >= 300);
    assert.equal(decodeQrMatrix(encodeQr(text).modules).text, text);
  });

  it("chooses the smallest version for each level, up to 40", () => {
    for (const level of ["L", "M", "Q", "H"] as const) {
      for (let v = 1; v <= QR_MAX_VERSION; v++) {
        const cap = byteCapacity(v, level);
        assert.equal(chooseVersion(cap, level), v, `${level} ${cap} bytes`);
        if (v < QR_MAX_VERSION) assert.equal(chooseVersion(cap + 1, level), v + 1, `${level} ${cap + 1} bytes`);
      }
    }
    assert.equal(chooseVersion(byteCapacity(QR_MAX_VERSION, "H") + 1, "H"), null);
  });

  it("tryEncodeQr returns null instead of throwing when nothing fits", () => {
    assert.equal(tryEncodeQr("x".repeat(3000)), null);
    assert.ok(tryEncodeQr("hello"));
  });
});

describe("authenticator URIs", () => {
  it("the worst-case URI (60-character brand, 254-character email) still encodes", () => {
    const brand = "Académie de Formation Professionnelle Continue et Numériq";
    const email = `${"a".repeat(64)}@${"sub-domain-example-".repeat(9)}example.edu`.slice(0, 254);
    const uri = buildOtpauthUri({ issuer: brand, account: email, secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });
    const qr = encodeQr(uri);
    assert.equal(decodeQrMatrix(qr.modules).text, uri);
    assert.ok(Buffer.byteLength(uri) < 300 && qr.version <= 12, `the capped label keeps the code small (${Buffer.byteLength(uri)} bytes, version ${qr.version})`);
  });
});

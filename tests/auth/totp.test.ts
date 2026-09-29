import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  formatSecretForDisplay,
  generateTotpSecret,
  hotp,
  normalizeTotpInput,
  totpCode,
  totpStep,
  verifyTotp,
} from "@/lib/auth/totp";

/** The shared secret of the RFC 4226 / RFC 6238 test vectors. */
const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32 (RFC 4648)", () => {
  it("encodes the RFC 4648 test vectors (unpadded)", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, encoded] of vectors) assert.equal(base32Encode(Buffer.from(plain)), encoded, plain);
    assert.equal(base32Encode(RFC_KEY), RFC_SECRET);
  });

  it("decodes case-insensitively, ignoring spaces, dashes and padding", () => {
    assert.equal(base32Decode("mzxw6ytboi")?.toString(), "foobar");
    assert.equal(base32Decode("MZXW 6YTB-OI======")?.toString(), "foobar");
    assert.deepEqual(base32Decode(RFC_SECRET), RFC_KEY);
  });

  it("rejects invalid input", () => {
    assert.equal(base32Decode(""), null);
    assert.equal(base32Decode("===="), null);
    assert.equal(base32Decode("MZXW1"), null);
    assert.equal(base32Decode("MZXW8"), null);
    assert.equal(base32Decode("MZ!W6"), null);
  });

  it("round-trips random bytes", () => {
    for (let length = 1; length <= 40; length++) {
      const bytes = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + length * 11) & 0xff));
      assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
    }
  });
});

describe("HOTP (RFC 4226 appendix D)", () => {
  it("matches the published values for counters 0-9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => assert.equal(hotp(RFC_KEY, counter), code, `counter ${counter}`));
  });
});

describe("TOTP (RFC 6238 appendix B, SHA-1)", () => {
  it("matches the published 8-digit values", () => {
    const vectors: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, code] of vectors) assert.equal(totpCode(RFC_SECRET, seconds * 1000, 8), code, `t=${seconds}`);
  });

  it("uses 30-second steps and 6 digits by default", () => {
    assert.equal(totpStep(59_000), 1);
    assert.equal(totpStep(60_000), 2);
    assert.equal(totpCode(RFC_SECRET, 59_000), "287082");
    assert.match(totpCode(RFC_SECRET), /^\d{6}$/);
  });

  it("throws for an invalid secret", () => {
    assert.throws(() => totpCode("not base32!", 0));
  });
});

describe("normalizeTotpInput", () => {
  it("strips spaces and dashes", () => {
    assert.equal(normalizeTotpInput("123 456"), "123456");
    assert.equal(normalizeTotpInput(" 123-456 "), "123456");
  });

  it("requires exactly six digits", () => {
    for (const input of ["12345", "1234567", "abcdef", "12345a", ""]) assert.equal(normalizeTotpInput(input), null, input);
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000_000;
  const step = totpStep(now);
  const codeAt = (offsetSteps: number) => totpCode(RFC_SECRET, now + offsetSteps * 30_000);

  it("accepts the current step and returns it", () => {
    assert.equal(verifyTotp(RFC_SECRET, codeAt(0), { nowMs: now }), step);
  });

  it("tolerates one step of clock drift either way", () => {
    assert.equal(verifyTotp(RFC_SECRET, codeAt(-1), { nowMs: now }), step - 1);
    assert.equal(verifyTotp(RFC_SECRET, codeAt(1), { nowMs: now }), step + 1);
  });

  it("rejects codes outside the window", () => {
    assert.equal(verifyTotp(RFC_SECRET, codeAt(-2), { nowMs: now }), null);
    assert.equal(verifyTotp(RFC_SECRET, codeAt(2), { nowMs: now }), null);
    assert.equal(verifyTotp(RFC_SECRET, codeAt(-1), { nowMs: now, window: 0 }), null);
    assert.equal(verifyTotp(RFC_SECRET, codeAt(-2), { nowMs: now, window: 2 }), step - 2);
  });

  it("refuses a replayed step and any step at or before the last accepted one", () => {
    const accepted = verifyTotp(RFC_SECRET, codeAt(0), { nowMs: now });
    assert.equal(accepted, step);
    assert.equal(verifyTotp(RFC_SECRET, codeAt(0), { nowMs: now, lastStep: accepted! }), null);
    assert.equal(verifyTotp(RFC_SECRET, codeAt(-1), { nowMs: now, lastStep: accepted! }), null);
    assert.equal(verifyTotp(RFC_SECRET, codeAt(1), { nowMs: now, lastStep: accepted! }), step + 1);
  });

  it("accepts formatted input and rejects garbage", () => {
    const code = codeAt(0);
    assert.equal(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now }), step);
    assert.equal(verifyTotp(RFC_SECRET, "abcdef", { nowMs: now }), null);
    assert.equal(verifyTotp("!!!", code, { nowMs: now }), null);
  });

  it("rejects a wrong code", () => {
    const wrong = String((Number(codeAt(0)) + 1) % 1_000_000).padStart(6, "0");
    const valid = new Set([codeAt(-1), codeAt(0), codeAt(1)]);
    if (!valid.has(wrong)) assert.equal(verifyTotp(RFC_SECRET, wrong, { nowMs: now }), null);
  });
});

describe("secrets and otpauth URIs", () => {
  it("generates 160-bit random secrets", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    assert.match(a, /^[A-Z2-7]{32}$/);
    assert.equal(base32Decode(a)?.length, 20);
    assert.notEqual(a, b);
  });

  it("groups a secret in blocks of four", () => {
    assert.equal(formatSecretForDisplay("ABCDEFGHIJ"), "ABCD EFGH IJ");
    assert.equal(formatSecretForDisplay("ABCDEFGH"), "ABCD EFGH");
  });

  it("builds a key URI authenticator apps understand", () => {
    const uri = buildOtpauthUri({ issuer: "Learn: Loop", account: "ada lovelace@example.com", secret: RFC_SECRET });
    const url = new URL(uri);
    assert.equal(url.protocol, "otpauth:");
    assert.ok(uri.startsWith("otpauth://totp/Learn%20Loop:ada%20lovelace%40example.com?"), uri);
    assert.ok(!uri.includes("+"), "spaces must be %20, not +");
    assert.equal(url.searchParams.get("secret"), RFC_SECRET);
    assert.equal(url.searchParams.get("issuer"), "Learn Loop");
    // SHA-1 / 6 digits / 30 s are every app's defaults, so they are left out to keep the QR code small.
    assert.equal(url.searchParams.get("algorithm"), null);
    assert.equal(url.searchParams.get("digits"), null);
    assert.equal(url.searchParams.get("period"), null);
  });

  it("keeps long brands and addresses to a scannable length", () => {
    const brand = "Académie de Formation Professionnelle Continue et Numérique";
    const account = `${"firstname.lastname".repeat(6)}@university-example.edu`;
    const uri = buildOtpauthUri({ issuer: brand, account, secret: RFC_SECRET });
    const url = new URL(uri);
    const issuer = url.searchParams.get("issuer")!;
    assert.ok([...issuer].length <= 32 && issuer.endsWith("…"), issuer);
    const label = decodeURIComponent(uri.slice("otpauth://totp/".length, uri.indexOf("?")));
    assert.ok(label.startsWith(`${issuer}:`), label);
    assert.ok([...label.slice(issuer.length + 1)].length <= 64, label);
    assert.ok(Buffer.byteLength(uri) < 300, `${Buffer.byteLength(uri)} bytes`);
  });

  it("falls back to a default issuer", () => {
    assert.ok(buildOtpauthUri({ issuer: ":::", account: "a@b.co", secret: "AAAA" }).startsWith("otpauth://totp/LearnLoop:"));
  });
});

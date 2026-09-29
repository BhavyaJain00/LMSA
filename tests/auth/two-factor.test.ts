import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RECOVERY_CODE_COUNT,
  TWO_FACTOR_COOKIE,
  clearTwoFactorChallengeCookie,
  consumeSecondFactor,
  findRecoveryCodeIndex,
  generateRecoveryCodes,
  hashRecoveryCode,
  newTotpSecret,
  normalizeRecoveryCode,
  openTotpSecret,
  otpauthUriFor,
  readSecondFactorInput,
  readTwoFactorChallengeCookie,
  sealTotpSecret,
  setTwoFactorChallengeCookie,
} from "@/lib/auth/two-factor";
import { totpCode } from "@/lib/auth/totp";
import { findById } from "@/lib/db/store";
import { makeUser, resetDb } from "../helpers/db";
import { requestCookie, resetRequest } from "../helpers/request";

describe("TOTP secret sealing", () => {
  it("round-trips through AES-GCM and fails closed when tampered", () => {
    const secret = newTotpSecret();
    const sealed = sealTotpSecret(secret);
    assert.ok(!sealed.includes(secret));
    assert.equal(openTotpSecret({ twoFactorSecretEnc: sealed }), secret);
    const parts = sealed.split(".");
    parts[3] = (parts[3]![0] === "A" ? "B" : "A") + parts[3]!.slice(1);
    assert.equal(openTotpSecret({ twoFactorSecretEnc: parts.join(".") }), null);
    assert.equal(openTotpSecret({}), null);
  });

  it("builds the otpauth URI for the account email", () => {
    assert.ok(otpauthUriFor({ email: "ada@example.com" }, "JBSWY3DP", "LearnLoop").includes("LearnLoop:ada%40example.com"));
  });
});

describe("recovery codes", () => {
  it("generates ten unique xxxxx-xxxxx codes from an unambiguous alphabet", () => {
    const codes = generateRecoveryCodes();
    assert.equal(codes.length, RECOVERY_CODE_COUNT);
    assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT);
    for (const code of codes) assert.match(code, /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });

  it("normalises what people type", () => {
    assert.equal(normalizeRecoveryCode(" K7M2P-XQ9HA "), "k7m2pxq9ha");
    assert.equal(normalizeRecoveryCode("k7m2p xq9ha"), "k7m2pxq9ha");
    assert.equal(normalizeRecoveryCode("k7m2p-xq9h"), null);
    assert.equal(normalizeRecoveryCode("k7m2p-xq9hi"), null);
    assert.equal(normalizeRecoveryCode("o0l1i-xq9ha"), null);
  });

  it("hashes codes with a keyed HMAC, independent of formatting", () => {
    const hash = hashRecoveryCode("k7m2p-xq9ha");
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hashRecoveryCode("K7M2P XQ9HA"), hash);
    assert.notEqual(hashRecoveryCode("k7m2p-xq9hb"), hash);
  });

  it("finds the matching stored hash", () => {
    const codes = generateRecoveryCodes(4);
    const hashes = codes.map(hashRecoveryCode);
    assert.equal(findRecoveryCodeIndex(hashes, codes[2]!.toUpperCase()), 2);
    assert.equal(findRecoveryCodeIndex(hashes, "aaaaa-aaaaa"), -1);
    assert.equal(findRecoveryCodeIndex(hashes, "not a code"), -1);
    assert.equal(findRecoveryCodeIndex([], codes[0]!), -1);
    assert.equal(findRecoveryCodeIndex(undefined, codes[0]!), -1);
    assert.equal(findRecoveryCodeIndex(["zz", "", hashes[1]!], codes[1]!), 2);
  });
});

describe("consumeSecondFactor (store)", () => {
  const secret = newTotpSecret();
  const codes = generateRecoveryCodes(3);
  const now = Date.parse("2026-07-01T12:00:00Z");
  const enabled = makeUser({
    id: "usr_2fa",
    twoFactorEnabled: true,
    twoFactorSecretEnc: sealTotpSecret(secret),
    recoveryCodeHashes: codes.map(hashRecoveryCode),
  });
  const pending = makeUser({ id: "usr_pending", twoFactorSecretEnc: sealTotpSecret(secret) });
  const broken = makeUser({ id: "usr_broken", twoFactorEnabled: true, twoFactorSecretEnc: "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA" });
  const plain = makeUser({ id: "usr_plain" });

  beforeEach(async () => {
    await resetDb({ users: [enabled, pending, broken, plain] });
  });

  it("accepts a TOTP code once and records the step (replay protection)", async () => {
    const code = totpCode(secret, now);
    const first = await consumeSecondFactor(enabled.id, { method: "totp", code }, { nowMs: now });
    assert.equal(first.ok, true);
    assert.equal((await findById("users", enabled.id))?.twoFactorLastStep, Math.floor(now / 30_000));
    assert.deepEqual(await consumeSecondFactor(enabled.id, { method: "totp", code }, { nowMs: now }), { ok: false, reason: "invalid_code" });
    const next = await consumeSecondFactor(enabled.id, { method: "totp", code: totpCode(secret, now + 30_000) }, { nowMs: now + 30_000 });
    assert.equal(next.ok, true);
  });

  it("rejects wrong and malformed codes", async () => {
    const code = totpCode(secret, now + 10 * 60_000);
    assert.deepEqual(await consumeSecondFactor(enabled.id, { method: "totp", code }, { nowMs: now }), { ok: false, reason: "invalid_code" });
    assert.deepEqual(await consumeSecondFactor(enabled.id, { method: "totp", code: "12ab56" }, { nowMs: now }), { ok: false, reason: "invalid_code" });
  });

  it("consumes each recovery code once", async () => {
    const used = await consumeSecondFactor(enabled.id, { method: "recovery", code: codes[1]! });
    assert.deepEqual(used, { ok: true, method: "recovery", remaining: 2 });
    assert.deepEqual(await consumeSecondFactor(enabled.id, { method: "recovery", code: codes[1]! }), { ok: false, reason: "invalid_code" });
    assert.equal((await findById("users", enabled.id))?.recoveryCodeHashes?.length, 2);
  });

  it("requires 2FA to be enabled, except when confirming a pending setup with a TOTP code", async () => {
    const code = totpCode(secret, now);
    assert.deepEqual(await consumeSecondFactor(pending.id, { method: "totp", code }, { nowMs: now }), { ok: false, reason: "not_enabled" });
    assert.equal((await consumeSecondFactor(pending.id, { method: "totp", code }, { nowMs: now, requireEnabled: false })).ok, true);
    assert.deepEqual(await consumeSecondFactor(pending.id, { method: "recovery", code: codes[0]! }, { requireEnabled: false }), { ok: false, reason: "invalid_code" });
    assert.deepEqual(await consumeSecondFactor(plain.id, { method: "totp", code }, { nowMs: now }), { ok: false, reason: "not_enabled" });
    assert.deepEqual(await consumeSecondFactor("usr_missing", { method: "totp", code }, { nowMs: now }), { ok: false, reason: "not_enabled" });
  });

  it("reports a secret that can no longer be decrypted", async () => {
    assert.deepEqual(await consumeSecondFactor(broken.id, { method: "totp", code: "123456" }), { ok: false, reason: "unreadable_secret" });
  });
});

describe("second-factor form input and challenge cookie", () => {
  it("reads the method and the matching field", () => {
    const totp = new FormData();
    totp.set("code", " 123 456 ");
    totp.set("recoveryCode", "ignored");
    assert.deepEqual(readSecondFactorInput(totp), { method: "totp", code: "123 456" });
    const recovery = new FormData();
    recovery.set("method", "recovery");
    recovery.set("recoveryCode", "k7m2p-xq9ha");
    assert.deepEqual(readSecondFactorInput(recovery), { method: "recovery", code: "k7m2p-xq9ha" });
    const long = new FormData();
    long.set("code", "9".repeat(200));
    assert.equal(readSecondFactorInput(long).code.length, 64);
  });

  it("sets, reads and clears the httpOnly challenge cookie", async () => {
    resetRequest();
    assert.equal(await readTwoFactorChallengeCookie(), null);
    await setTwoFactorChallengeCookie("raw-token");
    assert.equal(requestCookie(TWO_FACTOR_COOKIE), "raw-token");
    assert.equal(await readTwoFactorChallengeCookie(), "raw-token");
    await clearTwoFactorChallengeCookie();
    assert.equal(await readTwoFactorChallengeCookie(), null);
  });
});

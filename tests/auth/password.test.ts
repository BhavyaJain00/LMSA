import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, validatePasswordStrength, verifyPassword, verifyPasswordConstantTime } from "@/lib/auth/password";
import {
  PASSWORD_MAX_LENGTH,
  checkPasswordPolicy,
  clampMinLength,
  passwordRequirements,
  passwordStrength,
} from "@/lib/auth/password-policy";

describe("hashPassword / verifyPassword (scrypt)", () => {
  it("stores scrypt$N$salt$hash and verifies the right password only", async () => {
    const stored = await hashPassword("correct horse 42");
    assert.match(stored, /^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(await verifyPassword("correct horse 42", stored), true);
    assert.equal(await verifyPassword("correct horse 43", stored), false);
    assert.equal(await verifyPassword("", stored), false);
  });

  it("salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("same", a), true);
    assert.equal(await verifyPassword("same", b), true);
  });

  it("rejects malformed or unsafe stored hashes", async () => {
    const stored = await hashPassword("pw123456");
    const [, , salt, hex] = stored.split("$");
    for (const bad of [
      "",
      "plain-text",
      `bcrypt$16384$${salt}$${hex}`,
      `scrypt$16384$${salt}`,
      `scrypt$$${salt}$${hex}`,
      `scrypt$1000$${salt}$${hex}`,
      `scrypt$512$${salt}$${hex}`,
      `scrypt$${1 << 21}$${salt}$${hex}`,
      `scrypt$16384.5$${salt}$${hex}`,
      `scrypt$16384$${salt}$${hex!.slice(0, 64)}`,
    ]) {
      assert.equal(await verifyPassword("pw123456", bad), false, bad);
    }
  });

  it("verifyPasswordConstantTime works for real hashes and is false without one", async () => {
    const stored = await hashPassword("pw123456");
    assert.equal(await verifyPasswordConstantTime("pw123456", stored), true);
    assert.equal(await verifyPasswordConstantTime("pw123456", null), false);
    assert.equal(await verifyPasswordConstantTime("pw123456", undefined), false);
    assert.equal(await verifyPasswordConstantTime("", ""), false);
  });
});

describe("password policy", () => {
  it("clamps the configured minimum length to 8–64", () => {
    assert.equal(clampMinLength(undefined), 8);
    assert.equal(clampMinLength(null), 8);
    assert.equal(clampMinLength(Number.NaN), 8);
    assert.equal(clampMinLength(4), 8);
    assert.equal(clampMinLength(12.9), 12);
    assert.equal(clampMinLength(500), 64);
  });

  it("requires the minimum length, letters and numbers", () => {
    assert.equal(checkPasswordPolicy("abc12"), "Password must be at least 8 characters.");
    assert.equal(checkPasswordPolicy("abcdefgh"), "Password must contain letters and numbers.");
    assert.equal(checkPasswordPolicy("12345678"), "Password must contain letters and numbers.");
    assert.equal(checkPasswordPolicy("abcdefg1"), null);
    assert.equal(checkPasswordPolicy("abcdefg1", 12), "Password must be at least 12 characters.");
    assert.equal(checkPasswordPolicy("abcdefghijk1", 12), null);
  });

  it("counts characters, not UTF-16 units, and accepts any script", () => {
    assert.equal(checkPasswordPolicy("пароль12"), null);
    assert.equal(checkPasswordPolicy("🔒🔒🔒🔒🔒🔒a1"), null);
    assert.equal(checkPasswordPolicy("🔒🔒🔒a1"), "Password must be at least 8 characters.");
  });

  it("caps the length", () => {
    assert.equal(checkPasswordPolicy(`a1${"x".repeat(PASSWORD_MAX_LENGTH - 2)}`), null);
    assert.equal(checkPasswordPolicy(`a1${"x".repeat(PASSWORD_MAX_LENGTH - 1)}`), `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  });

  it("validatePasswordStrength uses the same policy with a configurable minimum", () => {
    assert.equal(validatePasswordStrength("abcdefg1"), null);
    assert.equal(validatePasswordStrength("abcdefg1", 10), "Password must be at least 10 characters.");
  });

  it("lists the individual requirements", () => {
    assert.deepEqual(
      passwordRequirements("abc", 10).map((r) => [r.id, r.met, r.label]),
      [
        ["length", false, "At least 10 characters"],
        ["letters", true, "Contains a letter"],
        ["numbers", false, "Contains a number"],
      ],
    );
  });
});

describe("passwordStrength", () => {
  it("scores empty and trivial passwords as too weak", () => {
    assert.equal(passwordStrength("").score, 0);
    assert.equal(passwordStrength("aaaaaaaa1").score <= 1, true);
  });

  it("penalises common passwords and personal details", () => {
    const common = passwordStrength("Password2024!");
    assert.ok(common.bits <= 24, `bits ${common.bits}`);
    assert.ok(common.suggestions.some((s) => s.includes("common")));
    const personal = passwordStrength("lovelace-Engine-1843-x", 8, ["Ada Lovelace", "ada@example.com"]);
    assert.ok(personal.bits <= 28);
    assert.ok(personal.suggestions.some((s) => s.includes("name or email")));
  });

  it("rates long random passphrases as strong", () => {
    const strong = passwordStrength("glacier Violet 7 teapot orbit Quantum");
    assert.equal(strong.meetsPolicy, true);
    assert.ok(strong.score >= 3, `score ${strong.score}`);
  });

  it("never rates a password that breaks the policy above 'Weak'", () => {
    const noDigits = passwordStrength("glacier Violet teapot orbit Quantum");
    assert.equal(noDigits.meetsPolicy, false);
    assert.ok(noDigits.score <= 1);
    assert.equal(noDigits.label, noDigits.score === 1 ? "Weak" : "Too weak");
  });

  it("returns at most two suggestions", () => {
    assert.ok(passwordStrength("abc1").suggestions.length <= 2);
  });
});

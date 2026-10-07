import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ActionResult, User } from "@/lib/types";
import { LOCALES, LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { catalogMessages, englishMessages, type MessageKey } from "@/i18n/catalog";
import { createTranslator } from "@/i18n/translate";
import { formatWait } from "@/lib/auth/account-status";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { lockedText, passwordPolicyText, rateLimitedText, waitText, type AuthTranslator } from "@/lib/auth/auth-messages";
import { changePasswordAction, forgotPasswordAction, loginAction, registerAction } from "@/lib/actions/auth";
import { hashPassword } from "@/lib/auth/password";
import { authRateLimiter } from "@/lib/auth/rate-limit";
import { createSession } from "@/lib/auth/session";
import { makeUser, resetDb } from "./helpers/db";
import { redirectTarget, resetRequest } from "./helpers/request";

const authT = (locale: Locale): AuthTranslator =>
  createTranslator<MessageKey<"auth">>({ locale, namespace: "auth", messages: catalogMessages(locale, "auth"), fallback: englishMessages("auth") });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("auth action messages: waits", () => {
  it("English waits read exactly like formatWait", () => {
    const en = authT("en");
    for (const ms of [0, 1, 30_000, 44_999, 45_000, 59_000, MINUTE, 61_000, 3 * MINUTE, 59 * MINUTE, 60 * MINUTE - 1, HOUR, HOUR + 1, 5 * HOUR, 30 * HOUR]) {
      assert.equal(waitText(en, ms), formatWait(ms), `ms=${ms}`);
    }
  });

  it("uses each language's plural forms", () => {
    assert.equal(waitText(authT("fr"), 2 * MINUTE), "2 minutes");
    assert.equal(waitText(authT("es"), HOUR), "1 hora");
    assert.equal(waitText(authT("es"), 3 * HOUR), "3 horas");
    assert.equal(waitText(authT("ar"), MINUTE), "دقيقة واحدة");
    assert.equal(waitText(authT("ar"), 2 * MINUTE), "دقيقتين");
    assert.match(waitText(authT("ar"), 5 * MINUTE), /دقائق$/);
    assert.match(waitText(authT("hi"), 10_000), /[ऀ-ॿ]/);
  });

  it("locked and rate-limited messages embed the translated wait and use the longest blocked limit", () => {
    assert.equal(
      lockedText(authT("en"), 15 * MINUTE),
      "Too many failed sign-in attempts. For your security, sign-in is paused for 15 minutes. You can reset your password to get back in sooner.",
    );
    assert.match(lockedText(authT("fr"), 15 * MINUTE), /suspendue pendant 15 minutes/);
    assert.equal(rateLimitedText(authT("en"), [MINUTE, 3 * MINUTE], "signIn"), "Too many sign-in attempts. Please wait 3 minutes and try again.");
    assert.equal(rateLimitedText(authT("en"), [], "reset"), "Too many reset requests. Please wait a few seconds and try again.");
    assert.match(rateLimitedText(authT("es"), [2 * HOUR], "signUp"), /Espera 2 horas/);
  });
});

describe("auth action messages: password policy", () => {
  const samples = ["", "short1", "abcdefgh", "12345678", "abcdefg1", "x".repeat(300), "ünïcødé9", "١٢٣٤٥٦٧٨ab"];

  it("English matches checkPasswordPolicy for every rule and minimum", () => {
    const en = authT("en");
    for (const min of [8, 12, 64, 200]) {
      for (const password of samples) assert.equal(passwordPolicyText(en, password, min), checkPasswordPolicy(password, min), `${JSON.stringify(password)} min=${min}`);
    }
  });

  it("is translated in every language and keeps the numbers", () => {
    for (const locale of LOCALES) {
      const t = authT(locale);
      assert.equal(passwordPolicyText(t, "abcdefg1", 8), null);
      assert.match(passwordPolicyText(t, "ab1", 10)!, /10|١٠/, locale);
      assert.match(passwordPolicyText(t, `a1${"x".repeat(300)}`, 8)!, /256|٢٥٦/, locale);
      assert.ok(passwordPolicyText(t, "abcdefghij", 8), locale);
    }
    assert.equal(passwordPolicyText(authT("fr"), "abc", 8), "Le mot de passe doit comporter au moins 8 caractères.");
    assert.equal(passwordPolicyText(authT("es"), "abcdefghij", 8), "La contraseña debe contener letras y números.");
  });
});

/* ------------------------------------------------------------------ */
/* The actions answer in the visitor's language                         */
/* ------------------------------------------------------------------ */

const PASSWORD = "correct horse 42";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

async function run(fn: () => Promise<ActionResult<unknown>>): Promise<ActionResult<unknown> | { redirect: string }> {
  try {
    return await fn();
  } catch (error) {
    const target = redirectTarget(error);
    if (target !== null) return { redirect: target };
    throw error;
  }
}

function failure(result: ActionResult<unknown> | { redirect: string }): { error: string; fieldErrors: Record<string, string> } {
  assert.ok(!("redirect" in result) && !result.ok, JSON.stringify(result));
  return { error: result.error, fieldErrors: result.fieldErrors ?? {} };
}

async function setup(locale: Locale | null, users: User[] = []): Promise<void> {
  await resetDb({ users, settings: { security: { maxLoginAttempts: 5, lockoutMinutes: 15 } } });
  authRateLimiter.resetPrefix("");
  resetRequest({ headers: { "user-agent": "node-test" }, cookies: locale ? { [LOCALE_COOKIE]: locale } : {} });
}

afterEach(() => {
  authRateLimiter.resetPrefix("");
  resetRequest();
});

describe("auth actions: messages follow the active language", () => {
  it("log in: English by default, the cookie language otherwise", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const ada = makeUser({ id: "usr_ada", email: "ada@example.com", passwordHash });

    await setup(null, [ada]);
    assert.equal(failure(await run(() => loginAction(null, form({ email: "ada@example.com", password: "nope nope 1" })))).error, "Incorrect email or password.");
    assert.equal(failure(await run(() => loginAction(null, form({ email: "", password: "" })))).error, "Please enter your email and password.");

    await setup("fr", [ada]);
    assert.equal(failure(await run(() => loginAction(null, form({ email: "ada@example.com", password: "nope nope 1" })))).error, "E-mail ou mot de passe incorrect.");

    await setup("ar", [{ ...ada, enabled: false }]);
    assert.equal(failure(await run(() => loginAction(null, form({ email: "ada@example.com", password: PASSWORD })))).error, "تم تعطيل هذا الحساب. تواصل مع الدعم.");
  });

  it("Accept-Language is honoured when there is no cookie", async () => {
    await resetDb({ users: [] });
    authRateLimiter.resetPrefix("");
    resetRequest({ headers: { "user-agent": "node-test", "accept-language": "es-ES,es;q=0.9" } });
    assert.equal(failure(await run(() => loginAction(null, form({ email: "", password: "" })))).error, "Introduce tu correo electrónico y tu contraseña.");
  });

  it("sign up: the summary and every field error are translated", async () => {
    const taken = makeUser({ id: "usr_taken", email: "taken@example.com" });
    await setup("es", [taken]);
    const invalid = failure(await run(() => registerAction(null, form({ name: "A", email: "not-an-email", password: "short" }))));
    assert.equal(invalid.error, "Corrige los errores que aparecen abajo.");
    assert.equal(invalid.fieldErrors.name, "Introduce tu nombre completo.");
    assert.equal(invalid.fieldErrors.email, "Introduce una dirección de correo electrónico válida.");
    assert.match(invalid.fieldErrors.password!, /^La contraseña debe tener al menos \d+ caracteres\.$/);

    const duplicate = failure(await run(() => registerAction(null, form({ name: "Ada Lovelace", email: "taken@example.com", password: "abcdefg123" }))));
    assert.equal(duplicate.error, "Ya existe una cuenta con este correo electrónico.");
    assert.equal(duplicate.fieldErrors.email, "Ya registrado");
  });

  it("forgot password: the confirmation and the validation error are translated", async () => {
    await setup("hi");
    const bad = failure(await run(() => forgotPasswordAction(null, form({ email: "nope" }))));
    assert.match(bad.error, /[ऀ-ॿ]/);
    const ok = await run(() => forgotPasswordAction(null, form({ email: "ghost@example.com" })));
    assert.ok(!("redirect" in ok) && ok.ok);
    assert.match(ok.message ?? "", /ghost@example\.com/);
    assert.match(ok.message ?? "", /[ऀ-ॿ]/);
  });

  it("change password: the account's saved language wins over the cookie", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const user = makeUser({ id: "usr_fr", email: "fr@example.com", passwordHash, locale: "fr" });
    await setup("es", [user]);
    await createSession(user.id);
    const wrong = failure(await run(() => changePasswordAction(null, form({ current: "wrong one 1", password: "abcdefg123", confirm: "abcdefg123" }))));
    assert.equal(wrong.error, "Le mot de passe actuel est incorrect.");
    assert.equal(wrong.fieldErrors.current, "Incorrect");
    const mismatch = failure(await run(() => changePasswordAction(null, form({ current: PASSWORD, password: "abcdefg123", confirm: "abcdefg124" }))));
    assert.equal(mismatch.error, "Les mots de passe ne correspondent pas.");
    assert.equal(mismatch.fieldErrors.confirm, "Ne correspond pas");
  });

  it("the auth layout keeps action messages out of the client payload", async () => {
    const { readFile } = await import("node:fs/promises");
    const layout = await readFile(new URL("../src/app/(auth)/layout.tsx", import.meta.url), "utf8");
    const prefixes = JSON.parse(/AUTH_CLIENT_KEYS = (\[[^\]]*\])/.exec(layout)![1]!) as string[];
    const shipped = Object.keys(englishMessages("auth")).filter((key) => prefixes.some((p) => key.startsWith(p)));
    assert.ok(shipped.includes("login.title"));
    assert.ok(!shipped.some((key) => /^(errors|fieldErrors|flash|notices|password|wait)\./.test(key)), shipped.join(", "));
  });
});

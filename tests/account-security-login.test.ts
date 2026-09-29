import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ActionResult, User } from "@/lib/types";
import { changePasswordAction, loginAction, registerAction } from "@/lib/actions/auth";
import { confirmTwoFactorSetupAction } from "@/lib/actions/security";
import { resetMemberPasswordAction } from "@/lib/actions/members";
import { hashPassword } from "@/lib/auth/password";
import { authRateLimiter } from "@/lib/auth/rate-limit";
import { getLoginThrottleStatus, LOGIN_FAILURE_MEMORY_MS, recordLoginFailure } from "@/lib/auth/login-throttle";
import { checkAuthToken, issueAuthToken } from "@/lib/auth/tokens";
import { confirmTwoFactorSetup, newTotpSecret, sealTotpSecret } from "@/lib/auth/two-factor";
import { totpCode } from "@/lib/auth/totp";
import { createSession, toPublicUser } from "@/lib/auth/session";
import { findById, getDb } from "@/lib/db/store";
import { makeUser, resetDb } from "./helpers/db";
import { redirectTarget, resetRequest } from "./helpers/request";

const PASSWORD = "correct horse 42";
const security = { maxLoginAttempts: 3, lockoutMinutes: 15 };
let passwordHash = "";

const LOCKED = /Too many failed sign-in attempts/;
const GENERIC = "Incorrect email or password.";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

/** Run an action; returns its result or, when it redirected, `{ redirect }`. */
async function run<T>(fn: () => Promise<T>): Promise<T | { redirect: string }> {
  try {
    return await fn();
  } catch (error) {
    const target = redirectTarget(error);
    if (target !== null) return { redirect: target };
    throw error;
  }
}

function errorOf(result: unknown): string {
  const r = result as ActionResult | { redirect: string };
  if ("redirect" in r) return `redirect:${r.redirect}`;
  return r.ok ? "ok" : r.error;
}

const login = (email: string, password: string, next?: string) => run(() => loginAction(null, form({ email, password, ...(next !== undefined ? { next } : {}) })));

async function setup(users: User[] = []): Promise<void> {
  passwordHash ||= await hashPassword(PASSWORD);
  await resetDb({ users, settings: { security } });
  authRateLimiter.resetPrefix("");
  resetRequest({ headers: { "user-agent": "node-test" } });
}

const ada = () => makeUser({ id: "usr_ada", email: "ada@example.com", passwordHash });

afterEach(() => {
  authRateLimiter.resetPrefix("");
});

describe("loginAction: lockout is serialized per email", () => {
  beforeEach(async () => setup([ada()]));

  it("parallel wrong guesses get exactly maxLoginAttempts tries, then the lock holds", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => login("ada@example.com", "wrong password 1")));
    const messages = results.map(errorOf);
    assert.equal(messages.filter((m) => m === GENERIC).length, security.maxLoginAttempts - 1, messages.join(" | "));
    assert.equal(messages.filter((m) => LOCKED.test(m)).length, 8 - (security.maxLoginAttempts - 1));
    // Even the right password is refused while locked.
    assert.match(errorOf(await login("ada@example.com", PASSWORD)), LOCKED);
    const stored = await findById("users", "usr_ada");
    assert.ok(stored?.lockedUntil, "the lock is mirrored onto the account for the admin screens");
  });

  it("a correct password queued behind failing guesses sees the lock", async () => {
    const attempts = [...Array.from({ length: 3 }, () => login("ada@example.com", "wrong password 1")), login("ada@example.com", PASSWORD)];
    const messages = (await Promise.all(attempts)).map(errorOf);
    assert.match(messages[3]!, LOCKED);
  });

  it("signs in and honours only safe next paths", async () => {
    assert.equal(errorOf(await login("ada@example.com", PASSWORD, "/courses?tab=mine")), "redirect:/courses?tab=mine");
    for (const evil of ["/\\evil.example", "/\t/evil.example", "//evil.example", "https://evil.example", "/..//evil.example"]) {
      assert.equal(errorOf(await login("ada@example.com", PASSWORD, evil)), "redirect:/dashboard", JSON.stringify(evil));
    }
  });
});

describe("loginAction: unknown and registered emails behave the same", () => {
  beforeEach(async () => setup([ada()]));

  it("gives identical answers for every attempt", async () => {
    for (let i = 0; i < 5; i++) {
      const known = errorOf(await login("ada@example.com", "wrong password 1"));
      const unknown = errorOf(await login("ghost@example.com", "wrong password 1"));
      assert.equal(known.replace(/\d+ minutes?|a few seconds/, "…"), unknown.replace(/\d+ minutes?|a few seconds/, "…"), `attempt ${i + 1}`);
    }
  });

  it("keeps the lock for both across a restart (in-memory state lost)", async () => {
    for (let i = 0; i < security.maxLoginAttempts; i++) {
      await login("ada@example.com", "wrong password 1");
      await login("ghost@example.com", "wrong password 1");
    }
    // A restart wipes every in-memory limiter; the throttle lives in the database.
    authRateLimiter.resetPrefix("");
    assert.match(errorOf(await login("ada@example.com", "wrong password 1")), LOCKED);
    assert.match(errorOf(await login("ghost@example.com", "wrong password 1")), LOCKED);
    const db = await getDb();
    assert.equal(db.loginThrottles.length, 2);
    assert.ok(db.loginThrottles.every((t) => !t.keyHash.includes("@")), "addresses are not stored in the clear");
  });

  it("forgets old failures the same way for both", async () => {
    const longAgo = new Date(Date.now() - LOGIN_FAILURE_MEMORY_MS - 60_000);
    for (const email of ["ada@example.com", "ghost@example.com"]) {
      for (let i = 0; i < security.maxLoginAttempts - 1; i++) await recordLoginFailure(email, security, longAgo);
    }
    assert.equal(errorOf(await login("ada@example.com", "wrong password 1")), GENERIC);
    assert.equal(errorOf(await login("ghost@example.com", "wrong password 1")), GENERIC);
    assert.equal((await getLoginThrottleStatus("ada@example.com")).failures, 1);
    assert.equal((await getLoginThrottleStatus("ghost@example.com")).failures, 1);
  });

  it("clears the counter after a successful sign-in", async () => {
    await login("ada@example.com", "wrong password 1");
    assert.equal(errorOf(await login("ada@example.com", PASSWORD)), "redirect:/dashboard");
    assert.deepEqual(await getLoginThrottleStatus("ada@example.com"), { locked: false, failures: 0, lockedUntil: null });
  });
});

describe("registerAction", () => {
  beforeEach(async () => setup([]));

  it("creates one account when two sign-ups race for the same email", async () => {
    const attempt = () => run(() => registerAction(null, form({ name: "Grace Hopper", email: "grace@example.com", password: "cobol 1959 rocks" })));
    const results = (await Promise.all([attempt(), attempt(), attempt()])).map(errorOf);
    assert.equal(results.filter((r) => r.startsWith("redirect:")).length, 1, results.join(" | "));
    assert.equal(results.filter((r) => r === "An account with this email already exists.").length, 2);
    const db = await getDb();
    assert.equal(db.users.filter((u) => u.email === "grace@example.com").length, 1);
  });

  it("gives racing sign-ups with the same local part different usernames", async () => {
    const results = await Promise.all(
      ["sam@one.example", "sam@two.example"].map((email) => run(() => registerAction(null, form({ name: "Sam Example", email, password: "password 12345" })))),
    );
    assert.ok(results.every((r) => errorOf(r).startsWith("redirect:")));
    const names = (await getDb()).users.map((u) => u.username).sort();
    assert.deepEqual(names, ["sam", "sam-2"]);
  });

  it("ignores unsafe next paths", async () => {
    const result = await run(() => registerAction(null, form({ name: "Evil Next", email: "next@example.com", password: "password 12345", next: "/\\evil.example" })));
    assert.equal(errorOf(result), "redirect:/persona");
  });
});

describe("changePasswordAction", () => {
  beforeEach(async () => {
    await setup([ada()]);
    await createSession("usr_ada");
  });

  it("revokes pending two-step sign-in challenges and reset links", async () => {
    const challenge = await issueAuthToken("usr_ada", "two_factor_login");
    const reset = await issueAuthToken("usr_ada", "password_reset");
    const result = await changePasswordAction(null, form({ current: PASSWORD, password: "brand new pass 7", confirm: "brand new pass 7" }));
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal((await checkAuthToken(challenge.token, "two_factor_login")).status, "invalid");
    assert.equal((await checkAuthToken(reset.token, "password_reset")).status, "invalid");
  });
});

describe("confirming two-step verification", () => {
  let secret = "";
  let sealed = "";

  beforeEach(async () => {
    secret = newTotpSecret();
    sealed = sealTotpSecret(secret);
    await setup([makeUser({ id: "usr_2fa", email: "two@example.com", passwordHash, twoFactorEnabled: false, twoFactorSecretEnc: sealed })]);
  });

  it("verifies and enables in one step", async () => {
    const result = await confirmTwoFactorSetup("usr_2fa", totpCode(secret), sealed, ["h1", "h2"]);
    assert.equal(result.ok, true);
    const row = await findById("users", "usr_2fa");
    assert.equal(row?.twoFactorEnabled, true);
    assert.equal(row?.twoFactorSecretEnc, sealed);
    assert.deepEqual(row?.recoveryCodeHashes, ["h1", "h2"]);
    assert.equal(typeof row?.twoFactorLastStep, "number");
  });

  it("refuses when the pending secret was replaced meanwhile (another tab restarted setup)", async () => {
    const other = sealTotpSecret(newTotpSecret());
    const db = await getDb();
    db.users.find((u) => u.id === "usr_2fa")!.twoFactorSecretEnc = other;
    const result = await confirmTwoFactorSetup("usr_2fa", totpCode(secret), sealed, ["h1"]);
    assert.deepEqual(result, { ok: false, reason: "changed" });
    const row = await findById("users", "usr_2fa");
    assert.equal(row?.twoFactorEnabled, false);
    assert.equal(row?.recoveryCodeHashes, undefined);
  });

  it("does not enable on a wrong code", async () => {
    const wrong = totpCode(secret) === "000000" ? "111111" : "000000";
    assert.deepEqual(await confirmTwoFactorSetup("usr_2fa", wrong, sealed, ["h1"]), { ok: false, reason: "invalid_code" });
    assert.equal((await findById("users", "usr_2fa"))?.twoFactorEnabled, false);
  });

  it("the action returns recovery codes once the code is confirmed", async () => {
    await createSession("usr_2fa");
    const result = await confirmTwoFactorSetupAction(null, form({ code: totpCode(secret) }));
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal(result.data.recoveryCodes.length, 10);
    assert.equal((await findById("users", "usr_2fa"))?.twoFactorEnabled, true);
  });
});

describe("toPublicUser", () => {
  it("drops secrets and account-security state", () => {
    const pub = toPublicUser(
      makeUser({
        twoFactorEnabled: true,
        twoFactorSecretEnc: "v1.x",
        twoFactorLastStep: 5,
        recoveryCodeHashes: ["x"],
        failedLoginCount: 2,
        lockedUntil: "2030-01-01T00:00:00Z",
        emailVerificationRequired: true,
        calendarToken: "tok",
      }),
    ) as Record<string, unknown>;
    for (const key of ["passwordHash", "twoFactorSecretEnc", "twoFactorLastStep", "recoveryCodeHashes", "calendarToken", "twoFactorEnabled", "failedLoginCount", "lockedUntil", "emailVerificationRequired"]) {
      assert.equal(key in pub, false, key);
    }
    assert.equal(typeof pub.name, "string");
  });
});

describe("admin 'set password' (resetMemberPasswordAction)", () => {
  beforeEach(async () => {
    await setup([makeUser({ id: "usr_admin", email: "admin@example.com", roles: ["admin"], passwordHash }), ada()]);
  });

  async function prepare(): Promise<{ reset: string; challenge: string }> {
    const reset = (await issueAuthToken("usr_ada", "password_reset")).token;
    const challenge = (await issueAuthToken("usr_ada", "two_factor_login")).token;
    resetRequest({ headers: { "user-agent": "member-device" } });
    await createSession("usr_ada");
    resetRequest({ headers: { "user-agent": "admin-device" } });
    await createSession("usr_admin");
    return { reset, challenge };
  }

  it("revokes reset links and challenges and signs the member out by default", async () => {
    const { reset, challenge } = await prepare();
    const result = await resetMemberPasswordAction(null, form({ id: "usr_ada", password: "new secret 99", confirm: "new secret 99" }));
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal((await checkAuthToken(reset, "password_reset")).status, "invalid");
    assert.equal((await checkAuthToken(challenge, "two_factor_login")).status, "invalid");
    assert.equal((await getDb()).sessions.filter((s) => s.userId === "usr_ada").length, 0);
  });

  it("keeps sessions only when the admin unticked the box (signOut=off)", async () => {
    const { reset } = await prepare();
    const result = await resetMemberPasswordAction(null, form({ id: "usr_ada", password: "new secret 99", confirm: "new secret 99", signOut: "off" }));
    assert.ok(result.ok, result.ok ? "" : result.error);
    assert.equal((await checkAuthToken(reset, "password_reset")).status, "invalid");
    assert.equal((await getDb()).sessions.filter((s) => s.userId === "usr_ada").length, 1);
  });

  it("the ticked checkbox wins over the hidden fallback field", async () => {
    await prepare();
    const data = form({ id: "usr_ada", password: "new secret 99", confirm: "new secret 99" });
    data.append("signOut", "on");
    data.append("signOut", "off");
    const result = await resetMemberPasswordAction(null, data);
    assert.ok(result.ok);
    assert.equal((await getDb()).sessions.filter((s) => s.userId === "usr_ada").length, 0);
  });
});

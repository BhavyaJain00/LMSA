import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { AuthToken } from "@/lib/types";
import {
  AUTH_TOKEN_TTL_MS,
  checkAuthToken,
  consumeAuthToken,
  generateRawToken,
  hashAuthToken,
  isWellFormedToken,
  issueAuthToken,
  revokeAuthToken,
  revokeAuthTokens,
  tokenState,
} from "@/lib/auth/tokens";
import { getDb } from "@/lib/db/store";
import { flushDb, makeUser, resetDb } from "../helpers/db";

const DAY = 24 * 60 * 60 * 1000;
const ada = makeUser({ id: "usr_ada" });
const bob = makeUser({ id: "usr_bob" });
const disabled = makeUser({ id: "usr_off", enabled: false });

describe("token helpers", () => {
  it("generates 256-bit base64url tokens and hashes them with SHA-256", () => {
    const raw = generateRawToken();
    assert.match(raw, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hashAuthToken(raw), createHash("sha256").update(raw).digest("hex"));
    assert.notEqual(generateRawToken(), raw);
  });

  it("recognises well-formed tokens only", () => {
    assert.equal(isWellFormedToken(generateRawToken()), true);
    for (const bad of [null, undefined, "", "short", `${"a".repeat(43)}=`, "a".repeat(44), `${"a".repeat(42)}!`]) {
      assert.equal(isWellFormedToken(bad), false, String(bad));
    }
  });

  it("tokenState checks use before expiry", () => {
    const now = Date.parse("2026-05-01T10:00:00Z");
    assert.equal(tokenState({ expiresAt: "2026-05-01T11:00:00Z" }, now), "valid");
    assert.equal(tokenState({ expiresAt: "2026-05-01T10:00:00Z" }, now), "expired");
    assert.equal(tokenState({ expiresAt: "2026-05-01T09:00:00Z" }, now), "expired");
    assert.equal(tokenState({ expiresAt: "garbage" }, now), "expired");
    assert.equal(tokenState({ expiresAt: "2026-05-01T11:00:00Z", usedAt: "2026-05-01T09:59:00Z" }, now), "used");
  });
});

describe("issue / check / consume (store)", () => {
  beforeEach(async () => {
    await resetDb({ users: [ada, bob, disabled] });
  });

  it("stores only the SHA-256 hash with a purpose-specific lifetime", async () => {
    const now = new Date("2026-05-01T10:00:00Z");
    const { token, record } = await issueAuthToken(ada.id, "password_reset", now);
    assert.equal(record.tokenHash, hashAuthToken(token));
    assert.equal(Date.parse(record.expiresAt) - now.getTime(), AUTH_TOKEN_TTL_MS.password_reset);
    assert.equal(AUTH_TOKEN_TTL_MS.password_reset, 60 * 60 * 1000);
    assert.equal(AUTH_TOKEN_TTL_MS.email_verification, DAY);
    assert.equal(AUTH_TOKEN_TTL_MS.two_factor_login, 10 * 60 * 1000);
    await flushDb();
    const file = await readFile(process.env.DATA_FILE!, "utf8");
    assert.ok(file.includes(record.tokenHash));
    assert.ok(!file.includes(token), "the raw token must never be persisted");
  });

  it("checks without consuming, then consumes exactly once", async () => {
    const { token } = await issueAuthToken(ada.id, "password_reset");
    const check = await checkAuthToken(token, "password_reset");
    assert.equal(check.status, "valid");
    assert.equal(check.user?.id, ada.id);
    assert.equal((await checkAuthToken(token, "password_reset")).status, "valid");

    const consumed = await consumeAuthToken(token, "password_reset");
    assert.equal(consumed?.user.id, ada.id);
    assert.ok(consumed?.token.usedAt);
    assert.equal(await consumeAuthToken(token, "password_reset"), null);
    assert.equal((await checkAuthToken(token, "password_reset")).status, "used");
  });

  it("lets only one of two concurrent requests consume a token", async () => {
    const { token } = await issueAuthToken(ada.id, "email_verification");
    const results = await Promise.all([consumeAuthToken(token, "email_verification"), consumeAuthToken(token, "email_verification")]);
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("binds tokens to their purpose", async () => {
    const { token } = await issueAuthToken(ada.id, "password_reset");
    assert.equal((await checkAuthToken(token, "email_verification")).status, "invalid");
    assert.equal(await consumeAuthToken(token, "two_factor_login"), null);
    assert.equal((await checkAuthToken(token, "password_reset")).status, "valid");
  });

  it("expires tokens", async () => {
    const issuedAt = new Date("2026-05-01T10:00:00Z");
    const { token } = await issueAuthToken(ada.id, "two_factor_login", issuedAt);
    const later = issuedAt.getTime() + AUTH_TOKEN_TTL_MS.two_factor_login + 1;
    assert.equal((await checkAuthToken(token, "two_factor_login", later)).status, "expired");
    assert.equal(await consumeAuthToken(token, "two_factor_login", new Date(later)), null);
  });

  it("rejects unknown, malformed and disabled-account tokens", async () => {
    assert.equal((await checkAuthToken(generateRawToken(), "password_reset")).status, "invalid");
    assert.equal((await checkAuthToken("not-a-token", "password_reset")).status, "invalid");
    assert.equal((await checkAuthToken(null, "password_reset")).status, "invalid");
    const { token } = await issueAuthToken(disabled.id, "password_reset");
    assert.equal((await checkAuthToken(token, "password_reset")).status, "invalid");
    assert.equal(await consumeAuthToken(token, "password_reset"), null);
  });

  it("invalidates older unused tokens of the same purpose and user only", async () => {
    const first = await issueAuthToken(ada.id, "password_reset");
    const verify = await issueAuthToken(ada.id, "email_verification");
    const bobs = await issueAuthToken(bob.id, "password_reset");
    const second = await issueAuthToken(ada.id, "password_reset");
    assert.equal((await checkAuthToken(first.token, "password_reset")).status, "invalid");
    assert.equal((await checkAuthToken(second.token, "password_reset")).status, "valid");
    assert.equal((await checkAuthToken(verify.token, "email_verification")).status, "valid");
    assert.equal((await checkAuthToken(bobs.token, "password_reset")).status, "valid");
  });

  it("purges tokens that have been dead for more than a week when issuing", async () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const old: AuthToken = {
      id: "atk_old",
      userId: bob.id,
      purpose: "password_reset",
      tokenHash: hashAuthToken(generateRawToken()),
      expiresAt: new Date(now.getTime() - 8 * DAY).toISOString(),
      createdAt: new Date(now.getTime() - 9 * DAY).toISOString(),
    };
    const recent: AuthToken = { ...old, id: "atk_recent", usedAt: new Date(now.getTime() - DAY).toISOString(), expiresAt: now.toISOString() };
    await resetDb({ users: [ada, bob], authTokens: [old, recent] });
    await issueAuthToken(ada.id, "email_verification", now);
    const ids = (await getDb()).authTokens.map((t) => t.id);
    assert.ok(!ids.includes("atk_old"));
    assert.ok(ids.includes("atk_recent"));
  });

  it("revokes tokens", async () => {
    const reset = await issueAuthToken(ada.id, "password_reset");
    const verify = await issueAuthToken(ada.id, "email_verification");
    const challenge = await issueAuthToken(ada.id, "two_factor_login");
    assert.equal(await revokeAuthToken(challenge.token, "two_factor_login"), true);
    assert.equal(await revokeAuthToken(challenge.token, "two_factor_login"), false);
    assert.equal(await revokeAuthTokens(ada.id, "password_reset"), 1);
    assert.equal((await checkAuthToken(reset.token, "password_reset")).status, "invalid");
    assert.equal((await checkAuthToken(verify.token, "email_verification")).status, "valid");
    assert.equal(await revokeAuthTokens(ada.id), 1);
    assert.equal((await checkAuthToken(verify.token, "email_verification")).status, "invalid");
  });
});

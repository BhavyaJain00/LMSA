import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ApiKey } from "@/lib/types";
import { API_KEY_NAMESPACE, generateApiKey, hashApiKey, maskApiKey, matchApiKey, parseApiKey, readBearerToken } from "@/lib/api/keys";
import { API_SCOPE_IDS, READ_ONLY_SCOPES, SCOPE_GROUPS, hasScope, isApiScope, normalizeScopes } from "@/lib/api/scopes";

function storedKey(overrides: Partial<ApiKey> = {}): { row: ApiKey; key: string } {
  const generated = generateApiKey();
  return {
    key: generated.key,
    row: { id: "key_1", name: "Zapier", prefix: generated.prefix, keyHash: generated.keyHash, scopes: ["courses:read"], createdById: "usr_admin", createdAt: "2026-01-01T00:00:00.000Z", ...overrides },
  };
}

describe("API key format", () => {
  it("generates ll_live_<id>_<secret> keys with a stored prefix and SHA-256 hash", () => {
    const { key, prefix, keyHash } = generateApiKey();
    assert.match(key, /^ll_live_[a-z0-9]{10}_[A-Za-z0-9]{40}$/);
    assert.ok(key.startsWith(`${prefix}_`));
    assert.match(prefix, /^ll_live_[a-z0-9]{10}$/);
    assert.equal(keyHash, hashApiKey(key));
    assert.match(keyHash, /^[0-9a-f]{64}$/);
    assert.ok(!keyHash.includes(key));
  });

  it("never repeats keys or prefixes", () => {
    const keys = new Set<string>();
    const prefixes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const k = generateApiKey();
      keys.add(k.key);
      prefixes.add(k.prefix);
    }
    assert.equal(keys.size, 200);
    assert.equal(prefixes.size, 200);
  });

  it("parses only well-formed keys", () => {
    const { key, prefix } = generateApiKey();
    assert.deepEqual(parseApiKey(key)?.prefix, prefix);
    assert.equal(parseApiKey(`${key}x`), null);
    assert.equal(parseApiKey(key.replace(API_KEY_NAMESPACE, "ll_test_")), null);
    assert.equal(parseApiKey(key.slice(0, -1)), null);
    assert.equal(parseApiKey(""), null);
    assert.equal(parseApiKey(null), null);
    assert.equal(parseApiKey(`${key.slice(0, -1)}-`), null);
    assert.equal(parseApiKey("x".repeat(5000)), null);
  });

  it("reads bearer tokens case-insensitively and rejects other schemes", () => {
    assert.equal(readBearerToken("Bearer abc"), "abc");
    assert.equal(readBearerToken("bearer   abc  "), "abc");
    assert.equal(readBearerToken("Basic abc"), null);
    assert.equal(readBearerToken("Bearer"), null);
    assert.equal(readBearerToken("Bearer a b"), null);
    assert.equal(readBearerToken(null), null);
    assert.equal(readBearerToken(`Bearer ${"a".repeat(400)}`), null);
  });

  it("masks keys for display", () => {
    assert.equal(maskApiKey("ll_live_abc"), "ll_live_abc_••••••••");
  });
});

describe("API key verification", () => {
  it("accepts the exact key", () => {
    const { row, key } = storedKey();
    const match = matchApiKey([row], key);
    assert.equal(match.status, "valid");
    assert.equal(match.status === "valid" && match.key.id, row.id);
  });

  it("rejects a wrong secret for a known prefix", () => {
    const { row, key } = storedKey();
    const tampered = `${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`;
    assert.equal(matchApiKey([row], tampered).status, "invalid");
  });

  it("rejects unknown and malformed keys", () => {
    const { row } = storedKey();
    assert.equal(matchApiKey([row], generateApiKey().key).status, "invalid");
    assert.equal(matchApiKey([row], "not-a-key").status, "invalid");
    assert.equal(matchApiKey([row], null).status, "invalid");
    assert.equal(matchApiKey([], row.keyHash).status, "invalid");
  });

  it("reports revoked keys separately", () => {
    const { row, key } = storedKey({ revokedAt: "2026-02-01T00:00:00.000Z" });
    assert.equal(matchApiKey([row], key).status, "revoked");
  });

  it("does not accept the stored hash as a key", () => {
    const { row } = storedKey();
    assert.equal(matchApiKey([row], `${row.prefix}_${row.keyHash.slice(0, 40)}`).status, "invalid");
  });
});

describe("API scopes", () => {
  it("lists every scope from the brief", () => {
    assert.deepEqual(
      [...API_SCOPE_IDS].sort(),
      ["courses:read", "courses:write", "enrollments:read", "enrollments:write", "payments:read", "progress:read", "users:read", "users:write", "webhooks:manage"].sort(),
    );
    assert.ok(READ_ONLY_SCOPES.every((s) => s.endsWith(":read")));
    assert.equal(SCOPE_GROUPS.flatMap((g) => g.scopes).length, API_SCOPE_IDS.length);
  });

  it("grants exact scopes, and read access through the matching write scope", () => {
    assert.equal(hasScope(["courses:read"], "courses:read"), true);
    assert.equal(hasScope(["courses:write"], "courses:read"), true);
    assert.equal(hasScope(["courses:read"], "courses:write"), false);
    assert.equal(hasScope(["users:write"], "courses:read"), false);
    assert.equal(hasScope(["enrollments:write"], "enrollments:read"), true);
    assert.equal(hasScope(["webhooks:manage"], "courses:read"), false);
    assert.equal(hasScope([], "payments:read"), false);
    // A write scope never implies a different resource's read scope.
    assert.equal(hasScope(["payments:write"], "payments:read"), true);
    assert.equal(hasScope(["progress:write"], "courses:read"), false);
  });

  it("normalizes scope input: known only, no duplicates, canonical order", () => {
    assert.deepEqual(normalizeScopes(["users:read", "courses:read", "bogus", "users:read", 5, null]), ["courses:read", "users:read"]);
    assert.equal(isApiScope("courses:read"), true);
    assert.equal(isApiScope("courses:admin"), false);
  });
});

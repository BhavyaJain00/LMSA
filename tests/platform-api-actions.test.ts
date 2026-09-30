import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApiKeyAction, deleteApiKeyAction, revokeApiKeyAction, setApiEnabledAction } from "@/lib/actions/api-keys";
import { hashApiKey, matchApiKey } from "@/lib/api/keys";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/** Admin → Settings → API & webhooks: key lifecycle and the API switch. */

const admin = makeUser({ id: "usr_admin", name: "Admin", roles: ["admin"] });
const otherAdmin = makeUser({ id: "usr_admin2", name: "Second admin", roles: ["admin"] });
const moderator = makeUser({ id: "usr_mod", roles: ["moderator"] });

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

describe("API key actions", () => {
  beforeEach(async () => {
    await resetDb({ users: [admin, otherAdmin, moderator], settings: { email: { enabled: false } } });
  });

  it("only lets administrators manage keys", async () => {
    await signIn(moderator.id);
    const res = await createApiKeyAction(null, form({ name: "Zapier", scopes: ["courses:read"] }));
    assert.equal(res.ok, false);
    assert.equal((await setApiEnabledAction(false)).ok, false);
    assert.equal((await getDb()).apiKeys.length, 0);
  });

  it("validates the name and permissions", async () => {
    await signIn(admin.id);
    const res = await createApiKeyAction(null, form({ name: "x", scopes: ["nope"] }));
    assert.ok(!res.ok);
    assert.ok(res.fieldErrors?.name);
    assert.ok(res.fieldErrors?.scopes);
  });

  it("returns the key once and stores only its hash", async () => {
    await signIn(admin.id);
    const res = await createApiKeyAction(null, form({ name: "  CRM   sync ", scopes: ["users:read", "courses:read", "users:read", "bogus"] }));
    assert.ok(res.ok);
    const db = await getDb();
    const [row] = db.apiKeys;
    assert.equal(row!.name, "CRM sync");
    assert.deepEqual(row!.scopes, ["courses:read", "users:read"]);
    assert.equal(row!.keyHash, hashApiKey(res.data.key));
    assert.ok(!JSON.stringify(db).includes(res.data.key), "the full key is never stored");
    assert.equal(matchApiKey(db.apiKeys, res.data.key).status, "valid");
    assert.ok(db.auditEvents.some((e) => e.action === "api_key.create" && e.targetId === row!.id));
    assert.ok(db.notifications.some((n) => n.userId === otherAdmin.id && n.subject.includes("CRM sync")));
    assert.ok(!db.notifications.some((n) => n.userId === admin.id));
  });

  it("revokes, then deletes, a key", async () => {
    await signIn(admin.id);
    const created = await createApiKeyAction(null, form({ name: "Script", scopes: ["payments:read"] }));
    assert.ok(created.ok);
    const early = await deleteApiKeyAction(created.data.id);
    assert.equal(early.ok, false);
    assert.ok((await revokeApiKeyAction(created.data.id)).ok);
    let db = await getDb();
    assert.equal(matchApiKey(db.apiKeys, created.data.key).status, "revoked");
    assert.ok((await deleteApiKeyAction(created.data.id)).ok);
    db = await getDb();
    assert.equal(db.apiKeys.length, 0);
    assert.deepEqual(
      db.auditEvents.map((e) => e.action).filter((a) => a.startsWith("api_key.")),
      ["api_key.create", "api_key.revoke", "api_key.delete"],
    );
  });

  it("switches the API off and on", async () => {
    await signIn(admin.id);
    const off = await setApiEnabledAction(false);
    assert.ok(off.ok);
    assert.equal((await getDb()).settings.api.enabled, false);
    await setApiEnabledAction(true);
    const db = await getDb();
    assert.equal(db.settings.api.enabled, true);
    assert.equal(db.auditEvents.filter((e) => e.action === "settings.api").length, 2);
  });
});

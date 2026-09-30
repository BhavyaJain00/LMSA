import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INDEXNOW_KEY_PATH,
  INDEXNOW_MAX_URLS,
  buildIndexNowPayloads,
  describeIndexNowResult,
  generateIndexNowKey,
  indexNowKeyFromPath,
  isPingableOrigin,
  isValidIndexNowKey,
} from "@/lib/seo/indexnow";
import { ensureIndexNowKey, lastIndexNowResult, submitToIndexNow } from "@/lib/seo/indexnow-client";
import { getSettings } from "@/lib/db/store";
import { resetDb } from "./helpers/db";

/** IndexNow: key rules, request bodies and the cases in which nothing may be sent. */

const ORIGIN = "https://learn.example.com";

describe("IndexNow keys", () => {
  it("accepts 8 to 128 letters, digits and dashes", () => {
    for (const ok of ["abcd1234", "A1-b2-C3-d4", "f".repeat(128)]) assert.ok(isValidIndexNowKey(ok), ok);
    for (const bad of ["short", "f".repeat(129), "has space1", "under_score1", "emoji😀key1", "", undefined, null]) assert.ok(!isValidIndexNowKey(bad), String(bad));
  });

  it("generates random 32-character hexadecimal keys", () => {
    const a = generateIndexNowKey();
    const b = generateIndexNowKey();
    assert.match(a, /^[a-f0-9]{32}$/);
    assert.ok(isValidIndexNowKey(a));
    assert.notEqual(a, b);
  });

  it("recognises the key file path at the site root only", () => {
    const key = "0123456789abcdef0123456789abcdef";
    assert.equal(indexNowKeyFromPath(`/${key}.txt`), key);
    for (const path of ["/robots.txt", "/indexnow.txt", `/files/${key}.txt`, `/${key}`, `/${key}.txt/`, `/${key.toUpperCase()}.txt`, `/${key}0.txt`, "/"]) assert.equal(indexNowKeyFromPath(path), null, path);
  });
});

describe("isPingableOrigin", () => {
  it("is true for public host names", () => {
    for (const origin of [ORIGIN, "https://example.com", "http://172.32.0.1"]) assert.ok(isPingableOrigin(origin), origin);
  });

  it("is false for local and private addresses", () => {
    for (const origin of [
      "http://localhost:3000",
      "http://app.localhost",
      "http://127.0.0.1:3000",
      "http://10.1.2.3",
      "http://192.168.1.20",
      "http://172.16.0.1",
      "http://172.31.255.1",
      "http://0.0.0.0:3000",
      "http://[::1]:3000",
      "http://lms.local",
      "http://lms.test",
      "http://lms.internal",
      "http://intranet",
      "nonsense",
    ]) {
      assert.ok(!isPingableOrigin(origin), origin);
    }
  });
});

describe("buildIndexNowPayloads", () => {
  it("keeps this site's URLs, once each, and names the key file", () => {
    const payloads = buildIndexNowPayloads(ORIGIN, "abcd1234", [
      `${ORIGIN}/courses/a`,
      `${ORIGIN}/courses/a`,
      `${ORIGIN}/blog/b`,
      "https://other.example.org/x",
      "/relative",
      "not a url",
    ]);
    assert.deepEqual(payloads, [
      {
        host: "learn.example.com",
        key: "abcd1234",
        keyLocation: `${ORIGIN}${INDEXNOW_KEY_PATH}`,
        urlList: [`${ORIGIN}/courses/a`, `${ORIGIN}/blog/b`],
      },
    ]);
  });

  it("splits large submissions at the protocol limit", () => {
    const urls = Array.from({ length: INDEXNOW_MAX_URLS + 1 }, (_, i) => `${ORIGIN}/p/${i}`);
    const payloads = buildIndexNowPayloads(ORIGIN, "abcd1234", urls);
    assert.deepEqual(
      payloads.map((p) => p.urlList.length),
      [INDEXNOW_MAX_URLS, 1],
    );
  });

  it("returns nothing for an empty list or a malformed origin", () => {
    assert.deepEqual(buildIndexNowPayloads(ORIGIN, "abcd1234", []), []);
    assert.deepEqual(buildIndexNowPayloads("nonsense", "abcd1234", [`${ORIGIN}/a`]), []);
  });
});

describe("describeIndexNowResult", () => {
  it("explains each outcome in plain language", () => {
    assert.deepEqual(describeIndexNowResult({ ok: true, submitted: 1 }), { ok: true, text: "1 address sent to search engines" });
    assert.deepEqual(describeIndexNowResult({ ok: true, submitted: 1200 }), { ok: true, text: "1,200 addresses sent to search engines" });
    assert.equal(describeIndexNowResult({ ok: true, submitted: 0, skipped: "nothing-new" }).ok, true);
    assert.equal(describeIndexNowResult({ ok: true, submitted: 0, skipped: "noindex" }).ok, false);
    assert.match(describeIndexNowResult({ ok: true, submitted: 0, skipped: "local" }).text, /APP_URL/);
    assert.deepEqual(describeIndexNowResult({ ok: false, submitted: 0, error: "Search engines answered HTTP 403." }), { ok: false, text: "Search engines answered HTTP 403." });
    assert.equal(describeIndexNowResult({ ok: false, submitted: 0 }).ok, false);
  });
});

describe("IndexNow client", () => {
  it("creates a key on first use and keeps it afterwards", async () => {
    await resetDb();
    assert.equal((await getSettings()).seo.indexNowKey, undefined);
    const key = await ensureIndexNowKey();
    assert.match(key, /^[a-f0-9]{32}$/);
    assert.equal((await getSettings()).seo.indexNowKey, key);
    assert.equal(await ensureIndexNowKey(), key);
  });

  it("keeps a valid key typed by an admin and replaces an unusable one", async () => {
    await resetDb({ settings: { seo: { indexNowKey: "my-own-key-2026" } } });
    assert.equal(await ensureIndexNowKey(), "my-own-key-2026");
    await resetDb({ settings: { seo: { indexNowKey: "bad key" } } });
    assert.match(await ensureIndexNowKey(), /^[a-f0-9]{32}$/);
  });

  it("never calls search engines from a local address or a hidden site", async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(null, { status: 200 });
    });

    // The test environment runs on http://localhost:3000.
    await resetDb();
    const local = await submitToIndexNow(["/courses/a"]);
    assert.equal(local.ok, true);
    assert.equal(local.submitted, 0);
    assert.equal(local.skipped, "local");
    assert.equal(lastIndexNowResult()?.skipped, "local");
    // Skipped submissions do not create a key either.
    assert.equal((await getSettings()).seo.indexNowKey, undefined);

    await resetDb({ settings: { seo: { noindexSite: true } } });
    const hidden = await submitToIndexNow(["/courses/a"], { force: true });
    assert.equal(hidden.skipped, "noindex");
    assert.equal(hidden.submitted, 0);
    assert.deepEqual(calls, []);
  });
});

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANON_COOKIE,
  CONSENT_COOKIE,
  CONSENT_EVENT,
  CONSENT_OPEN_EVENT,
  isValidAnonId,
  normalizeConsentInput,
  optionalCookieCategory,
  parseConsentValue,
  serializeConsent,
  type ConsentState,
} from "@/lib/legal/consent-shared";
import { readConsentCookie, recordConsent } from "@/lib/legal/consent";
import { recordConsentAction } from "@/lib/actions/privacy";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { makeUser, resetDb } from "./helpers/db";
import { requestCookie, resetRequest } from "./helpers/request";

/** Round 3 legal-ops part 1: cookie consent (cookie format, evidence records, browser API). */

describe("consent cookie parsing", () => {
  it("accepts only the compact {a,m} format with 0/1 flags", () => {
    assert.deepEqual(parseConsentValue(serializeConsent({ analytics: false, marketing: true })), { analytics: false, marketing: true, decided: true });
    assert.deepEqual(parseConsentValue(encodeURIComponent('{"m":1,"a":1}')), { analytics: true, marketing: true, decided: true }, "key order does not matter");
    for (const raw of ['{"a":"1","m":"0"}', '{"a":1,"m":null}', "1", '"{"', "%7B%22a%22%3A1"]) {
      assert.equal(parseConsentValue(raw).decided, false, raw);
    }
  });

  it("reads the undecided state when the cookie is absent or tampered with", async () => {
    resetRequest({ cookies: { [CONSENT_COOKIE]: "%7B%22a%22%3A9%7D" } });
    assert.deepEqual(await readConsentCookie(), { analytics: false, marketing: false, decided: false });
  });
});

describe("consent input and visitor ids", () => {
  it("coerces untrusted action input", () => {
    assert.deepEqual(normalizeConsentInput({ analytics: true, marketing: false }), { analytics: true, marketing: false });
    assert.deepEqual(normalizeConsentInput({ analytics: false, marketing: false, extra: "x" }), { analytics: false, marketing: false }, "extra keys are dropped");
    for (const bad of [null, undefined, "yes", 1, [], [true, true], { analytics: "true", marketing: false }, { analytics: true }]) {
      assert.equal(normalizeConsentInput(bad), null, JSON.stringify(bad));
    }
  });

  it("accepts only well-formed visitor ids", () => {
    assert.equal(isValidAnonId("AbCdEf0123456789_-xy"), true);
    for (const bad of ["short", "x".repeat(65), "has space in the middle!", 42, undefined, "../../etc/passwd/xxxx"]) assert.equal(isValidAnonId(bad), false, String(bad));
  });

  it("classifies the cookies set by optional tags", () => {
    assert.equal(optionalCookieCategory("_ga"), "analytics");
    assert.equal(optionalCookieCategory("_ga_ABC123"), "analytics");
    assert.equal(optionalCookieCategory("_gid"), "analytics");
    assert.equal(optionalCookieCategory("_gat_UA-1"), "analytics");
    assert.equal(optionalCookieCategory("_fbp"), "marketing");
    assert.equal(optionalCookieCategory("_gcl_au"), "marketing");
    for (const essential of [CONSENT_COOKIE, ANON_COOKIE, "ll_session", "theme", "_gadget", "fbp"]) assert.equal(optionalCookieCategory(essential), null, essential);
  });
});

describe("consent evidence", () => {
  const member = makeUser({ id: "usr_consent_member" });
  const t0 = new Date("2026-09-01T10:00:00.000Z");
  const ids = { anonId: "anon_visitor_000000001" };

  beforeEach(async () => {
    await resetDb({ users: [member] });
    resetRequest();
  });

  it("stores each decision once per minute and every change", async () => {
    assert.ok(await recordConsent({ analytics: true, marketing: false }, ids, t0));
    assert.equal(await recordConsent({ analytics: true, marketing: false }, ids, new Date(t0.getTime() + 30_000)), null, "double click");
    assert.ok(await recordConsent({ analytics: false, marketing: false }, ids, new Date(t0.getTime() + 40_000)), "changed decision");
    assert.ok(await recordConsent({ analytics: false, marketing: false }, ids, new Date(t0.getTime() + 120_000)), "same decision later");
    assert.ok(await recordConsent({ analytics: false, marketing: false }, { ...ids, userId: member.id }, new Date(t0.getTime() + 130_000)), "now signed in");
    const rows = (await getDb()).consents;
    assert.equal(rows.length, 4);
    assert.equal(rows.at(-1)?.userId, member.id);
    assert.equal(rows[0]?.userId, undefined);
  });

  it("gives an anonymous visitor a random httpOnly id and keeps it", async () => {
    const first = await recordConsentAction({ analytics: true, marketing: true });
    assert.ok(first.ok);
    const anonId = requestCookie(ANON_COOKIE);
    assert.ok(isValidAnonId(anonId), "a visitor id cookie was set");
    const second = await recordConsentAction({ analytics: false, marketing: false });
    assert.ok(second.ok);
    assert.equal(requestCookie(ANON_COOKIE), anonId, "the id is reused");
    const rows = (await getDb()).consents;
    assert.deepEqual(
      rows.map((r) => [r.anonId, r.analytics, r.marketing, r.userId]),
      [
        [anonId, true, true, undefined],
        [anonId, false, false, undefined],
      ],
    );
  });

  it("replaces a malformed visitor id and links signed-in members", async () => {
    resetRequest({ cookies: { [ANON_COOKIE]: "bad id" } });
    await createSession(member.id);
    const res = await recordConsentAction({ analytics: false, marketing: true });
    assert.ok(res.ok);
    assert.notEqual(requestCookie(ANON_COOKIE), "bad id");
    const [row] = (await getDb()).consents;
    assert.equal(row?.userId, member.id);
    assert.equal(row?.marketing, true);
  });

  it("rejects malformed decisions without storing anything", async () => {
    const res = await recordConsentAction({ analytics: "yes", marketing: false });
    assert.equal(res.ok, false);
    assert.equal((await getDb()).consents.length, 0);
    assert.equal(requestCookie(ANON_COOKIE), undefined);
  });
});

/* ------------------------------------------------------------------ */
/* Browser API (consent-client.ts) against a minimal fake browser     */
/* ------------------------------------------------------------------ */

class FakeCookieJar {
  jar = new Map<string, string>();
  writes: string[] = [];
  get cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  set cookie(line: string) {
    this.writes.push(line);
    const [pair = "", ...attrs] = line.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (attrs.some((a) => a.trim().toLowerCase() === "max-age=0")) this.jar.delete(name);
    else this.jar.set(name, value);
  }
}

/** In-process stand-in for BroadcastChannel: delivers to every other open channel with the same name. */
class FakeChannel extends EventTarget {
  static open: FakeChannel[] = [];
  constructor(readonly name: string) {
    super();
    FakeChannel.open.push(this);
  }
  postMessage(data: unknown): void {
    for (const other of FakeChannel.open) if (other !== this && other.name === this.name) other.dispatchEvent(new MessageEvent("message", { data }));
  }
  close(): void {
    FakeChannel.open = FakeChannel.open.filter((c) => c !== this);
  }
}

describe("browser consent API", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window, BroadcastChannel: g.BroadcastChannel };
  const doc = new FakeCookieJar();
  const win = Object.assign(new EventTarget(), { location: { protocol: "https:", hostname: "learn.example.com" } });
  let client: typeof import("@/components/legal/consent-client");

  before(async () => {
    g.document = doc;
    g.window = win;
    g.BroadcastChannel = FakeChannel;
    client = await import("@/components/legal/consent-client");
  });

  after(() => {
    for (const channel of FakeChannel.open) channel.close();
    g.document = saved.document;
    g.window = saved.window;
    g.BroadcastChannel = saved.BroadcastChannel;
  });

  beforeEach(() => {
    doc.jar.clear();
    doc.writes = [];
  });

  it("is undecided until the visitor chooses", () => {
    assert.deepEqual(client.getConsent(), { analytics: false, marketing: false, decided: false });
  });

  it("stores the decision for a year, notifies listeners and reads it back", () => {
    const seen: ConsentState[] = [];
    const off = client.onConsentChange((s) => seen.push(s));
    const result = client.setConsent({ analytics: true, marketing: false });
    off();
    client.setConsent({ analytics: false, marketing: false });

    assert.deepEqual(result, { analytics: true, marketing: false, decided: true });
    assert.deepEqual(seen, [{ analytics: true, marketing: false, decided: true }], "unsubscribed listeners are not called");
    const write = doc.writes.find((w) => w.startsWith(`${CONSENT_COOKIE}=`)) ?? "";
    assert.match(write, /Max-Age=31536000/);
    assert.match(write, /SameSite=Lax/);
    assert.match(write, /Secure/);
    assert.deepEqual(client.getConsent(), { analytics: false, marketing: false, decided: true });
  });

  it("deletes the cookies of a category as soon as it is withdrawn", () => {
    doc.jar.set("_ga", "GA1.1.1");
    doc.jar.set("_ga_XYZ", "GS1");
    doc.jar.set("_fbp", "fb.1");
    doc.jar.set("ll_session", "keep");
    client.setConsent({ analytics: false, marketing: true });
    assert.equal(doc.jar.has("_ga"), false);
    assert.equal(doc.jar.has("_ga_XYZ"), false);
    assert.equal(doc.jar.has("_fbp"), true, "marketing is still allowed");
    assert.equal(doc.jar.get("ll_session"), "keep");
    assert.ok(doc.writes.some((w) => w.includes("_ga=; Path=/; Max-Age=0; Domain=.example.com")), "parent-domain copies are removed too");
  });

  it("replays decisions made in another tab", () => {
    const seen: ConsentState[] = [];
    const off = client.onConsentChange((s) => seen.push(s));
    const otherTab = new FakeChannel("ll-consent");
    otherTab.postMessage({ analytics: true, marketing: true });
    otherTab.postMessage({ analytics: "tampered" });
    otherTab.close();
    off();
    assert.deepEqual(seen, [{ analytics: true, marketing: true, decided: true }]);
  });

  it("opens the preferences dialog through a window event", () => {
    let opened = 0;
    const onOpen = () => opened++;
    win.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    client.openConsentSettings();
    win.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
    assert.equal(opened, 1);
    assert.equal(CONSENT_EVENT, "ll:consent");
  });
});

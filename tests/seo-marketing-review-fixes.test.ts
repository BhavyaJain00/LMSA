import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDb, mutate } from "@/lib/db/store";
import { confirmLeadAction, submitLeadAction } from "@/lib/actions/leads";
import { leadBlock } from "@/lib/comms/segments";
import { footerFingerprint, getFooterData } from "@/lib/data/seo";
import { jobValidThrough, minorUnitsToDecimal } from "@/lib/seo/jsonld";
import { leadConfirmUrl } from "@/lib/seo/lead-tokens";
import { OG_CACHE_CONTROL, OG_FALLBACK_CACHE_CONTROL, singleEntryMemo } from "@/lib/seo/og-cache";
import { canonicalOriginFor, proxyHopsFromEnv, requestHost, seoRedirectTarget, trustedForwardedHost } from "@/lib/seo/proxy-canonical";
import { sectionIsPublic } from "@/lib/seo/visibility";
import { buildSettings, makeCourse, makeCourseTree, makeEnrollment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/* ------------------------------------------------------------------ */
/* Lead form: no re-subscription and no enumeration                    */
/* ------------------------------------------------------------------ */

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

let n = 0;
const address = () => `review${++n}-${Date.now()}@example.com`;
const human = () => String(Date.now() - 5000);
const signUp = (email: string, extra: Record<string, string> = {}) => submitLeadAction(null, form({ email, consent: "on", source: "footer", renderedAt: human(), ...extra }));

function linkFields(url: string): FormData {
  return form(Object.fromEntries(new URL(url).searchParams));
}

describe("lead form after an unsubscribe", () => {
  const tree = makeCourseTree([[{ title: "Welcome", includeInPreview: true }]], { course: { id: "crs_sql", slug: "sql", title: "SQL basics" } });

  beforeEach(async () => {
    resetRequest();
    await resetDb({ users: [makeUser({ id: "usr_admin", roles: ["admin"] })], courses: [tree.course], chapters: tree.chapters, lessons: tree.lessons });
  });

  async function unsubscribedLead(email: string) {
    await mutate((db) => {
      db.leads.push({ id: "lead_v", email, source: "blog", consent: true, createdAt: "2026-01-01T00:00:00.000Z", confirmedAt: "2026-01-02T00:00:00.000Z", unsubscribedAt: "2026-02-01T00:00:00.000Z" });
    });
  }

  it("never re-subscribes an unsubscribed address from the public form", async () => {
    const email = address();
    await unsubscribedLead(email);
    const result = await signUp(email, { name: "Mallory" });
    assert.deepEqual(result, { ok: true, data: { status: "confirmation_sent" } });
    const stored = (await getDb()).leads.find((l) => l.email === email)!;
    assert.equal(stored.unsubscribedAt, "2026-02-01T00:00:00.000Z");
    assert.equal(leadBlock(stored), "unsubscribed");
    // The owner gets a fresh confirmation email instead.
    const mails = (await getDb()).emails.filter((m) => m.to === email);
    assert.equal(mails.length, 1);
    assert.match(mails[0]!.subject, /Confirm/);
  });

  it("subscribes the address again only through the signed confirmation link", async () => {
    const email = address();
    await unsubscribedLead(email);
    await signUp(email);
    const confirmed = await confirmLeadAction(linkFields(leadConfirmUrl("lead_v", email)));
    assert.equal(confirmed.ok, true);
    if (confirmed.ok) assert.equal(confirmed.message, "Your email is confirmed");
    const stored = (await getDb()).leads.find((l) => l.email === email)!;
    assert.equal(stored.unsubscribedAt, undefined);
    assert.equal(leadBlock(stored), null);
  });

  it("does not grant consent to a known address that never gave it", async () => {
    const email = address();
    await mutate((db) => {
      db.leads.push({ id: "lead_w", email, source: "waitlist", consent: false, createdAt: "2026-01-01T00:00:00.000Z" });
    });
    await signUp(email);
    const stored = (await getDb()).leads.find((l) => l.email === email)!;
    assert.equal(stored.consent, false);
    assert.equal(leadBlock(stored), "unconfirmed");
    await confirmLeadAction(linkFields(leadConfirmUrl("lead_w", email)));
    const after = (await getDb()).leads.find((l) => l.email === email)!;
    assert.equal(after.consent, true);
    assert.equal(leadBlock(after), null);
  });

  it("answers the same for a subscribed address as for a new one", async () => {
    const subscribed = address();
    await mutate((db) => {
      db.leads.push({ id: "lead_s", email: subscribed, source: "blog", consent: true, createdAt: "2026-01-01T00:00:00.000Z", confirmedAt: "2026-01-02T00:00:00.000Z" });
    });
    const known = await signUp(subscribed, { source: "course", courseId: "crs_sql" });
    const fresh = await signUp(address(), { source: "course", courseId: "crs_sql" });
    assert.deepEqual(known, fresh);
    assert.deepEqual(known, { ok: true, data: { status: "confirmation_sent" } });
    // The subscriber still gets what was asked for, by email only.
    assert.ok((await getDb()).emails.some((m) => m.to === subscribed && m.subject.startsWith("Syllabus")));
  });

  it("still records consent for a brand-new address (pending until confirmed)", async () => {
    const email = address();
    await signUp(email);
    const stored = (await getDb()).leads.find((l) => l.email === email)!;
    assert.equal(stored.consent, true);
    assert.equal(stored.confirmedAt, undefined);
    assert.equal(leadBlock(stored), "unconfirmed");
  });
});

/* ------------------------------------------------------------------ */
/* JSON-LD prices and job validity                                     */
/* ------------------------------------------------------------------ */

describe("structured data fixes", () => {
  it("formats app amounts (price × 100) with the currency's decimals", () => {
    assert.equal(minorUnitsToDecimal(4900, "USD"), "49.00");
    assert.equal(minorUnitsToDecimal(500000, "JPY"), "5000");
    assert.equal(minorUnitsToDecimal(500000, "KWD"), "5000.000");
    assert.equal(minorUnitsToDecimal(Number.NaN, "USD"), "0.00");
  });

  it("measures validThrough from the last update, like the auto-close", () => {
    const day = 86_400_000;
    assert.equal(jobValidThrough({ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" }, 90), new Date(Date.parse("2026-05-01T00:00:00.000Z") + 90 * day).toISOString());
    assert.equal(jobValidThrough({ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "" }, 90), new Date(Date.parse("2026-01-01T00:00:00.000Z") + 90 * day).toISOString());
    assert.equal(jobValidThrough({ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "garbage" }, 30), new Date(Date.parse("2026-01-01T00:00:00.000Z") + 30 * day).toISOString());
  });
});

/* ------------------------------------------------------------------ */
/* Share images                                                        */
/* ------------------------------------------------------------------ */

describe("share image gates and caching", () => {
  it("opens a section only when guests may browse and the feature is on", () => {
    const open = buildSettings();
    for (const section of ["courses", "batches", "programs", "jobs"] as const) assert.equal(sectionIsPublic(open, section), true, section);
    const membersOnly = buildSettings({ learning: { allowGuestAccess: false } });
    for (const section of ["courses", "batches", "programs", "jobs"] as const) assert.equal(sectionIsPublic(membersOnly, section), false, section);
    const noJobs = buildSettings({ features: { jobs: false, batches: false } });
    assert.equal(sectionIsPublic(noJobs, "jobs"), false);
    assert.equal(sectionIsPublic(noJobs, "batches"), false);
    assert.equal(sectionIsPublic(noJobs, "courses"), true);
  });

  it("sends cacheable headers (shorter for the fallback card)", () => {
    assert.match(OG_CACHE_CONTROL, /^public, .*s-maxage=86400/);
    assert.match(OG_FALLBACK_CACHE_CONTROL, /^public, max-age=300/);
  });

  it("renders the site card once per key and retries after a failure", async () => {
    const memo = singleEntryMemo<number>();
    let calls = 0;
    const make = async () => ++calls;
    assert.equal(await memo.get("a", make), 1);
    assert.equal(await memo.get("a", make), 1);
    assert.equal(await memo.get("b", make), 2);
    assert.equal(await memo.get("a", make), 3);
    await assert.rejects(memo.get("c", () => Promise.reject(new Error("boom"))));
    assert.equal(await memo.get("c", make), 4);
  });
});

/* ------------------------------------------------------------------ */
/* Canonical host                                                      */
/* ------------------------------------------------------------------ */

describe("canonical host behind proxies", () => {
  const ORIGIN = "https://example.com";

  it("ignores X-Forwarded-Host unless proxies are trusted", () => {
    // A client-sent header can't make the canonical URL redirect to itself.
    assert.equal(canonicalOriginFor({ host: "example.com", forwardedHost: "www.example.com", proxyHops: 0 }, ORIGIN, "www"), null);
    assert.equal(seoRedirectTarget({ pathname: "/x", search: "", host: "example.com", forwardedHost: "www.example.com", proxyHops: 0 }, () => null, ORIGIN, "www"), null);
    // Behind one trusted proxy the forwarded host is the visitor's.
    assert.equal(canonicalOriginFor({ host: "lms:3000", forwardedHost: "www.example.com", proxyHops: 1 }, ORIGIN, "www"), ORIGIN);
  });

  it("picks the entry written by the outermost trusted proxy", () => {
    assert.equal(trustedForwardedHost("www.example.com", 1), "www.example.com");
    assert.equal(trustedForwardedHost("forged.example.org, www.example.com", 1), "www.example.com");
    assert.equal(trustedForwardedHost("forged.example.org, www.example.com, edge.internal", 2), "www.example.com");
    assert.equal(trustedForwardedHost("www.example.com", 3), "www.example.com");
    assert.equal(trustedForwardedHost("www.example.com", 0), "");
    assert.equal(trustedForwardedHost(null, 2), "");
    assert.equal(requestHost({ host: "Example.com:443", forwardedHost: "www.example.com", proxyHops: 0 }), "example.com");
  });

  it("reads TRUST_PROXY_HOPS like the client-IP helper", () => {
    assert.equal(proxyHopsFromEnv(undefined), 0);
    assert.equal(proxyHopsFromEnv("2"), 2);
    assert.equal(proxyHopsFromEnv("-1"), 0);
    assert.equal(proxyHopsFromEnv("abc"), 0);
    assert.equal(proxyHopsFromEnv("999"), 20);
  });
});

/* ------------------------------------------------------------------ */
/* Footer cache                                                        */
/* ------------------------------------------------------------------ */

describe("footer data cache", () => {
  const fixture = () => ({
    settings: { brand: { name: "LearnLoop" } },
    users: [makeUser({ id: "usr_ada", roles: ["course_creator"] }), makeUser({ id: "usr_eve" })],
    categories: [{ id: "cat_design", name: "Design", slug: "design" }],
    courses: [makeCourse({ id: "crs_ux", slug: "ux", title: "UX", categoryId: "cat_design", instructorIds: ["usr_ada"] })],
    enrollments: [makeEnrollment({ userId: "usr_eve", courseId: "crs_ux" })],
  });

  it("changes the fingerprint when what the footer shows changes", async () => {
    const db = await resetDb(fixture());
    const base = footerFingerprint(db, db.settings, 2026);
    assert.equal(footerFingerprint(db, db.settings, 2026), base);
    assert.notEqual(footerFingerprint(db, db.settings, 2027), base);
    assert.notEqual(footerFingerprint({ ...db, courses: [...db.courses, makeCourse({ id: "crs_2", slug: "two" })] }, db.settings, 2026), base);
    assert.notEqual(footerFingerprint(db, { ...db.settings, brand: { ...db.settings.brand, name: "Other" } }, 2026), base);
  });

  it("serves the cached footer until something it shows changes", async () => {
    await resetDb(fixture());
    const first = await getFooterData();
    assert.equal(await getFooterData(), first);
    await mutate((db) => {
      db.settings.brand.name = "Renamed";
    });
    const second = await getFooterData();
    assert.notEqual(second, first);
    assert.equal(second.brandName, "Renamed");
    await mutate((db) => {
      db.courses.push(makeCourse({ id: "crs_new", slug: "new-course", title: "New course", categoryId: "cat_design", instructorIds: ["usr_ada"], updatedAt: "2099-01-01T00:00:00.000Z" }));
    });
    const third = await getFooterData();
    assert.ok(third.popularCourses.some((c) => c.href === "/courses/new-course"));
  });
});

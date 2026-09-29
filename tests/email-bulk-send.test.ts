import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Announcement, BatchEnrollment, LiveClass } from "@/lib/types";
import { markdownSafeUrl, personalize, prepareMarkdown } from "@/lib/email/personalize";
import {
  nextLiveClass,
  queueBatchAnnouncementEmails,
  queueBatchMessage,
  sendBatchAnnouncementEmails,
  sendBatchMessage,
  type BatchMessageInput,
} from "@/lib/email/batch";
import { EXTERNAL_RECIPIENT_RULES, WeightedQuota, reserveExternalRecipients, resetEmailQuotas } from "@/lib/email/quota";
import { getDb } from "@/lib/db/store";
import { makeBatch, makeUser, resetDb } from "./helpers/db";

const BASE = "https://lms.test";

describe("prepareMarkdown + personalize (render once, personalise per member)", () => {
  const values = { batch_title: "Intro *to* [x]", batch_url: "https://lms.test/batches/intro_(2026)", site_name: "LearnLoop" };

  it("inserts member values after parsing, escaped, so they can't add markup or links", () => {
    const prepared = prepareMarkdown("Hi **{{ member_name }}** ({{ member_email }}) — welcome to {{ batch_title }}.", { values, baseUrl: BASE, nonce: "t1" });
    const out = personalize(prepared, { member_name: '<img src=x onerror="alert(1)"> *[evil](javascript:alert(1))*', member_email: "ada@example.com" });
    assert.ok(!out.html.includes("<img"), out.html);
    assert.ok(!out.html.includes("<a "), out.html);
    assert.ok(out.html.includes("<strong"), out.html);
    assert.ok(out.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; *[evil](javascript:alert(1))*"), out.html);
    assert.ok(out.html.includes("Intro *to* [x]"), "audience values stay literal");
    assert.ok(out.text.startsWith('Hi <img src=x onerror="alert(1)"> *[evil](javascript:alert(1))* (ada@example.com)'), out.text);
  });

  it("gives each recipient their own values from one render", () => {
    const prepared = prepareMarkdown("Dear {{ member_name }}", { values, baseUrl: BASE });
    assert.equal(personalize(prepared, { member_name: "Ada" }).text, "Dear Ada");
    assert.equal(personalize(prepared, { member_name: "Alan" }).text, "Dear Alan");
    assert.ok(!Object.values(prepared.sentinels).some((s) => personalize(prepared, { member_name: "x" }).html.includes(s)));
  });

  it("percent-encodes member values inside link targets", () => {
    const prepared = prepareMarkdown("[profile](https://lms.test/u?name={{ member_name }}) [mail](mailto:{{ member_email }})", { values, baseUrl: BASE });
    const out = personalize(prepared, { member_name: 'A "B" <c>', member_email: "ada@example.com" });
    assert.ok(out.html.includes('href="https://lms.test/u?name=A%20%22B%22%20%3Cc%3E"'), out.html);
    assert.ok(out.html.includes('href="mailto:ada%40example.com"'), out.html);
  });

  it("turns {{ batch_url }} into a real link in HTML and text", () => {
    const prepared = prepareMarkdown("Join here: {{ batch_url }}\n\n[Open]({{ batch_url }})", { values, baseUrl: BASE });
    const out = personalize(prepared, {});
    const hrefs = [...out.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    const expected = "https://lms.test/batches/intro%5F%282026%29";
    assert.deepEqual(hrefs, [expected, expected]);
    assert.ok(out.text.includes("Join here: https://lms.test/batches/intro%5F%282026%29"), out.text);
    assert.equal(markdownSafeUrl("https://x.test/a b_(c)*~'"), "https://x.test/a%20b%5F%28c%29%2A%7E%27");
  });
});

describe("batch messages and announcements", () => {
  const author = makeUser({ id: "usr_author", roles: ["course_creator"], name: "Maya" });
  const ada = makeUser({ id: "usr_ada", name: "Ada **Bold**", email: "ada@example.com" });
  const bob = makeUser({ id: "usr_bob", name: "Bob", email: "bob@example.com" });
  const optedOut = makeUser({
    id: "usr_out",
    name: "Out",
    email: "out@example.com",
    emailPreferences: { enrollment: true, announcements: false, liveClasses: true, grading: true, certificates: true, discussions: true, reminders: true, payments: true },
  });
  const batch = makeBatch({ id: "bat_1", slug: "intro", title: "Intro", instructorIds: [author.id] });
  const emptyBatch = makeBatch({ id: "bat_empty", slug: "empty", title: "Empty" });
  const enroll = (userId: string, batchId = batch.id): BatchEnrollment => ({ id: `be_${userId}_${batchId}`, batchId, userId, confirmationEmailSent: true, enrolledAt: "2026-01-01T00:00:00.000Z" });
  const base: Omit<BatchMessageInput, "audience"> = { batchId: batch.id, subject: "Hello {{ member_name }}", body: "Hi {{ member_name }}, see {{ batch_url }}", senderId: author.id };

  before(() => {
    mock.method(console, "info", () => undefined);
  });
  after(() => mock.restoreAll());
  beforeEach(async () => {
    resetEmailQuotas();
    await resetDb({
      users: [author, ada, bob, optedOut],
      batches: [batch, emptyBatch],
      batchEnrollments: [enroll(ada.id), enroll(bob.id), enroll(optedOut.id)],
      settings: { email: { enabled: true, fromName: "LearnLoop", notifyTypes: ["announcement"] } },
    });
  });

  it("never treats an empty selection as everyone", async () => {
    for (const userIds of [[], undefined, ["usr_not_enrolled"]]) {
      const result = await sendBatchMessage({ ...base, audience: "selected", userIds, cc: ["mentor@example.org"] });
      assert.deepEqual(result, { ok: false, error: "Choose at least one student to email.", field: "recipients" });
    }
    assert.equal((await getDb()).emails.length, 0);
  });

  it("refuses an unknown audience and CC-only sends", async () => {
    const bad = await sendBatchMessage({ ...base, audience: "everyone" as unknown as "all" });
    assert.equal(bad.ok, false);
    const onlyOptedOut = await sendBatchMessage({ ...base, audience: "selected", userIds: [optedOut.id], cc: ["mentor@example.org"] });
    assert.equal(onlyOptedOut.ok, false);
    const noStudents = await sendBatchMessage({ ...base, batchId: emptyBatch.id, audience: "all", cc: ["mentor@example.org"] });
    assert.equal(noStudents.ok, false);
    assert.equal((await getDb()).emails.length, 0);
  });

  it("sends exactly to the selection, personalised and escaped", async () => {
    const result = await sendBatchMessage({ ...base, audience: "selected", userIds: [ada.id], cc: ["mentor@example.org"] });
    assert.deepEqual(result, { ok: true, queued: 1, skipped: 0, ccQueued: 1 });
    const emails = (await getDb()).emails;
    assert.deepEqual(emails.map((e) => e.to).sort(), ["ada@example.com", "mentor@example.org"]);
    const toAda = emails.find((e) => e.to === "ada@example.com")!;
    assert.equal(toAda.subject, "Hello Ada **Bold**");
    assert.ok(toAda.html.includes("Hi Ada **Bold**, see <a href=\"http://localhost:3000/batches/intro\""), toAda.html);
    const cc = emails.find((e) => e.to === "mentor@example.org")!;
    assert.ok(cc.text.includes("Hi learner"));
  });

  it("sends to everyone enrolled with audience=all, skipping opted-out members", async () => {
    const result = await sendBatchMessage({ ...base, audience: "all" });
    assert.deepEqual(result, { ok: true, queued: 2, skipped: 1, ccQueued: 0 });
  });

  it("queues in the background and reports the plan", async () => {
    const result = await queueBatchMessage({ ...base, audience: "all" });
    assert.deepEqual(result, { ok: true, queued: 2, skipped: 1, ccQueued: 0 });
    for (let i = 0; i < 50 && (await getDb()).emails.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await getDb()).emails.length, 2);
  });

  it("limits CC recipients per sender", async () => {
    const cc = Array.from({ length: 50 }, (_, i) => `guest${i}@example.org`);
    assert.equal((await sendBatchMessage({ ...base, audience: "all", cc })).ok, true);
    assert.equal((await sendBatchMessage({ ...base, audience: "all", cc })).ok, true);
    const third = await sendBatchMessage({ ...base, audience: "all", cc });
    assert.equal(third.ok, false);
    assert.equal(!third.ok && third.field, "cc");
    assert.equal(reserveExternalRecipients("someone_else", 50).ok, true);
  });

  it("skips CC-only announcement copies unless allowed", async () => {
    const announcement: Announcement = { id: "ann_1", batchId: batch.id, authorId: author.id, subject: "News", body: "Hello {{ member_name }}", cc: ["guest@example.org"], createdAt: "2026-01-01T00:00:00.000Z" };
    await resetDb({
      users: [author, optedOut],
      batches: [batch],
      batchEnrollments: [enroll(optedOut.id)],
      announcements: [announcement],
      settings: { email: { enabled: true, fromName: "LearnLoop", notifyTypes: ["announcement"] } },
    });
    const planned = await queueBatchAnnouncementEmails(announcement.id, { allowCcOnly: false });
    assert.deepEqual(planned, { queued: 0, skipped: 1, ccQueued: 0, ccSkipped: true });
    assert.deepEqual(await sendBatchAnnouncementEmails(announcement.id), { queued: 0, skipped: 1, ccQueued: 0, ccSkipped: true });
    assert.equal((await getDb()).emails.length, 0);
    const allowed = await sendBatchAnnouncementEmails(announcement.id, { ccOnlyAllowed: true });
    assert.equal(allowed.ccQueued, 1);
  });

  it("renders the announcement body once for all recipients", async () => {
    const announcement: Announcement = { id: "ann_2", batchId: batch.id, authorId: author.id, subject: "Hi {{ member_name }}", body: "*a ".repeat(6000), createdAt: "2026-01-01T00:00:00.000Z" };
    await resetDb({
      users: [author, ...Array.from({ length: 40 }, (_, i) => makeUser({ id: `usr_s${i}`, email: `s${i}@example.com` }))],
      batches: [batch],
      batchEnrollments: Array.from({ length: 40 }, (_, i) => enroll(`usr_s${i}`)),
      announcements: [announcement],
      settings: { email: { enabled: true, fromName: "LearnLoop", notifyTypes: ["announcement"] } },
    });
    const started = performance.now();
    const result = await sendBatchAnnouncementEmails(announcement.id);
    assert.equal(result.queued, 40);
    assert.ok(performance.now() - started < 2000, "40 recipients of a 18k-char body must not take seconds");
  });
});

describe("quota and live class helpers", () => {
  it("counts weighted units in a sliding window", () => {
    const quota = new WeightedQuota();
    const rules = [{ limit: 10, windowMs: 1000 }];
    assert.equal(quota.consume("k", 6, rules, 0).ok, true);
    const refused = quota.consume("k", 5, rules, 500);
    assert.equal(refused.ok, false);
    assert.equal(refused.retryAfterMs, 500);
    assert.equal(quota.consume("k", 5, rules, 1001).ok, true);
    assert.equal(EXTERNAL_RECIPIENT_RULES[0]!.limit, 100);
  });

  it("picks the next live class by its timezone-aware instant", () => {
    const make = (id: string, date: string, time: string, timezone: string, durationMinutes = 60): LiveClass => ({
      id,
      batchId: "b",
      title: id,
      date,
      time,
      timezone,
      durationMinutes,
      hostId: "h",
      provider: "custom",
      joinUrl: "",
      autoRecording: "none",
      attendeeIds: [],
      createdAt: "",
    });
    // 2026-09-29 20:30 UTC = 2026-09-30 02:00 in Kolkata: the class on the 29th (Kolkata) has ended.
    const now = Date.parse("2026-09-29T20:30:00Z");
    const ended = make("ended", "2026-09-29", "10:00", "Asia/Kolkata");
    const later = make("later", "2026-09-30", "10:00", "Asia/Kolkata");
    assert.equal(nextLiveClass([ended, later], "UTC", now)?.id, "later");
    // 2026-09-30 01:00 UTC = 2026-09-29 18:00 in Los Angeles: a class at 19:00 that evening is still ahead.
    const la = make("tonight", "2026-09-29", "19:00", "America/Los_Angeles");
    assert.equal(nextLiveClass([la, later], "UTC", Date.parse("2026-09-30T01:00:00Z"))?.id, "tonight");
    // A class that is in progress still counts until it ends.
    assert.equal(nextLiveClass([make("now", "2026-09-29", "20:00", "UTC", 60)], "UTC", now)?.id, "now");
    assert.equal(nextLiveClass([], "UTC", now), null);
  });
});

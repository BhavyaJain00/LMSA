import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Database, DataRequest } from "@/lib/types";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db/store";
import { EXPORT_FORMAT, personalDataSections, serializePersonalData, summarizeSections, USER_SECRET_FIELDS } from "@/lib/legal/export";
import { billedSubscriptions, DELETED_PASSWORD_HASH, DELETED_USER_NAME, deletedEmailFor, eraseAccountInDb, isDeletedAccount, isLastAdmin } from "@/lib/legal/erase";
import { countDataRequests, dataRequestRows, dataRequestsToCsv, parseDataRequestFilter } from "@/lib/legal/data-requests";
import { adminEraseAccountAction, deleteAccountAction } from "@/lib/actions/privacy";
import { FIXED_NOW, makePayment, makeUser, resetDb, type Fixture } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/**
 * A detached deep copy of the database. structuredClone() cannot copy the
 * store's tracking Proxies (its collections), while a JSON round trip can.
 */
const plainCopy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Round 3 legal-ops part 2: "Download my data" include/exclude rules, erasure, data requests. */

const ada = makeUser({
  id: "usr_ada",
  name: "Ada Lovelace",
  email: "Ada@Example.com",
  twoFactorEnabled: true,
  twoFactorSecretEnc: "enc:secret",
  recoveryCodeHashes: ["h1", "h2"],
  calendarToken: "cal-token",
});
const bob = makeUser({ id: "usr_bob", name: "Bob Other", email: "bob@example.com" });

function fixture(): Fixture {
  return {
    users: [ada, bob],
    sessions: [
      { id: "ses_ada", tokenHash: "hash-ada", userId: ada.id, createdAt: FIXED_NOW, expiresAt: "2099-01-01T00:00:00.000Z" },
      { id: "ses_bob", tokenHash: "hash-bob", userId: bob.id, createdAt: FIXED_NOW, expiresAt: "2099-01-01T00:00:00.000Z" },
    ],
    authTokens: [{ id: "tok_ada", userId: ada.id, purpose: "password_reset", tokenHash: "token-hash", expiresAt: FIXED_NOW, createdAt: FIXED_NOW }],
    notes: [
      { id: "note_ada", userId: ada.id, courseId: "crs_1", lessonId: "les_1", color: "yellow", note: "Mine", createdAt: FIXED_NOW },
      { id: "note_bob", userId: bob.id, courseId: "crs_1", lessonId: "les_1", color: "blue", note: "Not mine", createdAt: FIXED_NOW },
    ] as Database["notes"],
    payments: [
      makePayment({
        id: "pay_paid",
        userId: ada.id,
        itemId: "crs_1",
        status: "paid",
        invoiceNumber: "INV-0001",
        billingName: "Ada Lovelace",
        address: { line1: "1 Analytical St", city: "London", country: "GB" } as unknown as Database["payments"][number]["address"],
        gstin: "22AAAAA0000A1Z5",
        checkoutUrl: "https://checkout.example/secret",
      }),
      makePayment({ id: "pay_pending", userId: ada.id, itemId: "crs_2", status: "pending" }),
      makePayment({ id: "pay_bob", userId: bob.id, itemId: "crs_1", status: "paid", billingName: "Bob Other" }),
    ],
    emails: [
      { id: "em_reset", to: "ada@example.com", userId: ada.id, subject: "Reset", html: "<a href='/reset?t=SECRET'>", text: "reset SECRET", category: "password_reset", status: "sent", attempts: 1, createdAt: FIXED_NOW },
      { id: "em_welcome", to: "ADA@example.com", subject: "Welcome", html: "<p>Hi</p>", text: "Hi", category: "welcome", status: "sent", attempts: 1, createdAt: FIXED_NOW },
      { id: "em_bob", to: "bob@example.com", userId: bob.id, subject: "Welcome", html: "<p>Hi</p>", text: "Hi", category: "welcome", status: "sent", attempts: 1, createdAt: FIXED_NOW },
    ],
    leads: [
      { id: "lead_ada", email: "ada@example.com", source: "footer", consent: true, createdAt: FIXED_NOW },
      { id: "lead_bob", email: "bob@example.com", source: "footer", consent: true, createdAt: FIXED_NOW },
    ],
    consents: [{ id: "cns_ada", userId: ada.id, anonId: "anon-ada-0123456789", analytics: true, marketing: false, createdAt: FIXED_NOW }],
    loginEvents: [
      { id: "le_1", userId: ada.id, email: "ada@example.com", success: true, createdAt: FIXED_NOW },
      { id: "le_2", email: "ADA@example.com", success: false, reason: "bad_password", createdAt: FIXED_NOW },
      { id: "le_3", userId: bob.id, email: "bob@example.com", success: true, createdAt: FIXED_NOW },
    ],
    notifications: [{ id: "ntf_ada", userId: ada.id, type: "system", subject: "Hello", read: false, dedupeKey: "k1", createdAt: FIXED_NOW }],
    discussionTopics: [{ id: "top_ada", refType: "course", refId: "crs_1", courseId: "crs_1", authorId: ada.id, title: "Question", createdAt: FIXED_NOW, updatedAt: FIXED_NOW }],
    auditEvents: [
      { id: "aud_1", actorId: bob.id, action: "user.roles", targetType: "user", targetId: ada.id, meta: { to: "student" }, createdAt: FIXED_NOW },
      { id: "aud_2", actorId: ada.id, action: "settings.update", targetType: "settings", targetId: "seo", createdAt: FIXED_NOW },
    ],
  };
}

function section(db: Database, key: string) {
  const sections = personalDataSections(db, ada.id);
  assert.ok(sections);
  const found = sections.find((s) => s.key === key);
  assert.ok(found, `section ${key}`);
  return found.rows;
}

describe("personal data export", () => {
  let db: Database;
  beforeEach(async () => {
    db = plainCopy(await resetDb(fixture()));
  });

  it("returns null for an unknown member", () => {
    assert.equal(personalDataSections(db, "usr_missing"), null);
  });

  it("exports the profile without secrets", () => {
    const [account] = section(db, "account");
    assert.equal(account!.email, "Ada@Example.com");
    for (const field of USER_SECRET_FIELDS) assert.ok(!(field in account!), `${field} is left out`);
    assert.equal(account!.twoFactorEnabled, true, "non-secret flags stay");
  });

  it("drops token hashes from sessions and one-time tokens", () => {
    const sessions = section(db, "sessions");
    assert.deepEqual(sessions.map((s) => s.id), ["ses_ada"]);
    assert.ok(!("tokenHash" in sessions[0]!));
    const tokens = section(db, "authTokens");
    assert.equal(tokens.length, 1);
    assert.ok(!("tokenHash" in tokens[0]!));
  });

  it("only includes the member's own rows", () => {
    assert.deepEqual(section(db, "notes").map((n) => n.id), ["note_ada"]);
    assert.deepEqual(section(db, "payments").map((p) => p.id).sort(), ["pay_paid", "pay_pending"]);
    assert.deepEqual(section(db, "discussionTopics").map((t) => t.id), ["top_ada"]);
  });

  it("matches emails, sign-ins and leads by email address, case-insensitively", () => {
    assert.deepEqual(section(db, "emails").map((e) => e.id).sort(), ["em_reset", "em_welcome"]);
    assert.deepEqual(section(db, "loginEvents").map((e) => e.id).sort(), ["le_1", "le_2"]);
    assert.deepEqual(section(db, "leads").map((l) => l.id), ["lead_ada"]);
  });

  it("leaves out bodies of one-time-link emails, checkout links and notification keys", () => {
    const emails = section(db, "emails");
    const reset = emails.find((e) => e.id === "em_reset")!;
    assert.ok(!("html" in reset) && !("text" in reset), "reset link never exported");
    const welcome = emails.find((e) => e.id === "em_welcome")!;
    assert.equal(welcome.text, "Hi");
    assert.ok(!("html" in welcome));
    assert.ok(section(db, "payments").every((p) => !("checkoutUrl" in p)));
    assert.ok(!("dedupeKey" in section(db, "notifications")[0]!));
  });

  it("hides who acted on the member but keeps what they did", () => {
    const about = section(db, "auditEventsAboutYou");
    assert.deepEqual(about, [{ id: "aud_1", action: "user.roles", createdAt: FIXED_NOW }]);
    assert.deepEqual(section(db, "auditEventsByYou").map((e) => e.id), ["aud_2"]);
  });

  it("serializes to one valid JSON document with a table of contents", () => {
    const sections = personalDataSections(db, ada.id)!;
    const text = [...serializePersonalData(sections, { exportedAt: FIXED_NOW, siteName: "LearnLoop", siteUrl: "https://lms.example" })].join("");
    const parsed = JSON.parse(text) as { format: string; contents: { key: string; count: number }[]; data: Record<string, unknown[]> };
    assert.equal(parsed.format, EXPORT_FORMAT);
    assert.deepEqual(parsed.contents, summarizeSections(sections).map((s) => ({ key: s.key, description: s.description, count: s.count })));
    assert.equal(parsed.data.notes!.length, 1);
    assert.deepEqual(parsed.data.jobApplications, [], "empty sections are kept");
    assert.ok(!text.includes("SECRET") && !text.includes("hash-ada") && !text.includes("enc:secret"));
  });
});

describe("account erasure", () => {
  let db: Database;
  beforeEach(async () => {
    db = plainCopy(await resetDb(fixture()));
  });

  it("anonymizes the account and removes what only served the person", () => {
    const summary = eraseAccountInDb(db, ada.id, { now: new Date(FIXED_NOW), username: "deleted-abc" })!;
    const user = db.users.find((u) => u.id === ada.id)!;
    assert.equal(user.name, DELETED_USER_NAME);
    assert.equal(user.email, deletedEmailFor(ada.id));
    assert.equal(user.passwordHash, DELETED_PASSWORD_HASH);
    assert.equal(user.enabled, false);
    assert.equal(user.twoFactorSecretEnc, undefined);
    assert.equal(user.calendarToken, undefined);
    assert.ok(isDeletedAccount(user));

    assert.deepEqual(db.sessions.map((s) => s.id), ["ses_bob"]);
    assert.deepEqual(db.notes.map((n) => n.id), ["note_bob"]);
    assert.equal(db.authTokens.length, 0);
    assert.deepEqual(db.emails.map((e) => e.id), ["em_bob"]);
    assert.deepEqual(db.leads.map((l) => l.id), ["lead_bob"]);
    assert.deepEqual(db.loginEvents.map((e) => e.id), ["le_3"]);
    assert.equal(summary.removed.sessions, 1);
    assert.equal(summary.removed.emails, 2);
  });

  it("keeps order amounts and invoice numbers without personal data", () => {
    eraseAccountInDb(db, ada.id, { now: new Date(FIXED_NOW), username: "deleted-abc" });
    const paid = db.payments.find((p) => p.id === "pay_paid")!;
    assert.equal(paid.amount, 10000);
    assert.equal(paid.invoiceNumber, "INV-0001");
    assert.equal(paid.status, "paid");
    assert.equal(paid.billingName, DELETED_USER_NAME);
    assert.equal(paid.address, undefined);
    assert.equal(paid.gstin, undefined);
    assert.equal(paid.checkoutUrl, undefined);
    assert.equal(db.payments.find((p) => p.id === "pay_pending")!.status, "failed", "unpaid orders can no longer complete");
    assert.equal(db.payments.find((p) => p.id === "pay_bob")!.billingName, "Bob Other", "other members untouched");
  });

  it("keeps discussion posts (shown as Deleted user) and consent evidence without the member", () => {
    eraseAccountInDb(db, ada.id, { now: new Date(FIXED_NOW), username: "deleted-abc" });
    assert.equal(db.discussionTopics[0]!.authorId, ada.id);
    assert.equal(db.users.find((u) => u.id === db.discussionTopics[0]!.authorId)!.name, DELETED_USER_NAME);
    assert.equal(db.consents.length, 1);
    assert.equal(db.consents[0]!.userId, undefined);
  });

  it("returns null for an unknown member", () => {
    assert.equal(eraseAccountInDb(db, "usr_missing", { now: new Date(FIXED_NOW), username: "x" }), null);
  });

  it("protects the last administrator", () => {
    const admin = makeUser({ id: "usr_admin", roles: ["admin"] });
    const users = [admin, ada];
    assert.equal(isLastAdmin({ users }, admin.id), true);
    assert.equal(isLastAdmin({ users }, ada.id), false, "non-admins are never blocked");
    assert.equal(isLastAdmin({ users: [...users, makeUser({ id: "usr_admin2", roles: ["admin"] })] }, admin.id), false);
    assert.equal(isLastAdmin({ users: [...users, makeUser({ id: "usr_admin3", roles: ["admin"], enabled: false })] }, admin.id), true, "disabled admins don't count");
  });

  it("blocks deletion while a gateway still bills a membership", () => {
    const base = { planId: "pln_1", currentPeriodStart: FIXED_NOW, currentPeriodEnd: FIXED_NOW, createdAt: FIXED_NOW, updatedAt: FIXED_NOW, userId: ada.id };
    const subscriptions: Database["subscriptions"] = [
      { ...base, id: "sub_live", status: "active", cancelAtPeriodEnd: false, gateway: "stripe", gatewaySubscriptionId: "sub_123" },
      { ...base, id: "sub_ending", status: "active", cancelAtPeriodEnd: true, gateway: "stripe", gatewaySubscriptionId: "sub_456" },
      { ...base, id: "sub_manual", status: "active", cancelAtPeriodEnd: false, gateway: "manual" },
      { ...base, id: "sub_over", status: "cancelled", cancelAtPeriodEnd: false, gateway: "razorpay", gatewaySubscriptionId: "sub_789" },
    ];
    assert.deepEqual(billedSubscriptions({ subscriptions }, ada.id).map((s) => s.id), ["sub_live"]);
    assert.deepEqual(billedSubscriptions({ subscriptions }, bob.id), []);
  });
});

describe("data request rows", () => {
  const requests: DataRequest[] = [
    { id: "dreq_1", userId: ada.id, type: "export", status: "completed", createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z" },
    { id: "dreq_2", userId: "usr_gone", type: "delete", status: "completed", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "dreq_3", userId: bob.id, type: "export", status: "pending", createdAt: "2026-01-02T00:00:00.000Z" },
  ];
  const erased = { ...bob, id: "usr_erased", name: DELETED_USER_NAME, email: deletedEmailFor("usr_erased") };

  it("joins members, newest first, and hides erased members", () => {
    const rows = dataRequestRows([...requests, { ...requests[0]!, id: "dreq_4", userId: erased.id }], [ada, bob, erased], { type: "all", q: "" });
    assert.deepEqual(rows.map((r) => r.id), ["dreq_2", "dreq_3", "dreq_1", "dreq_4"]);
    const gone = rows.find((r) => r.id === "dreq_2")!;
    assert.equal(gone.name, DELETED_USER_NAME);
    assert.equal(gone.erased, true);
    const anonymized = rows.find((r) => r.id === "dreq_4")!;
    assert.equal(anonymized.email, "");
    assert.equal(anonymized.erased, true);
  });

  it("filters by type and free text", () => {
    assert.deepEqual(dataRequestRows(requests, [ada, bob], { type: "export", q: "" }).map((r) => r.id), ["dreq_3", "dreq_1"]);
    assert.deepEqual(dataRequestRows(requests, [ada, bob], { type: "all", q: "LOVELACE" }).map((r) => r.id), ["dreq_1"]);
    assert.deepEqual(dataRequestRows(requests, [ada, bob], { type: "all", q: "dreq_3" }).map((r) => r.id), ["dreq_3"]);
  });

  it("parses the filter defensively and counts per type", () => {
    const get = (values: Record<string, string>) => (key: string) => values[key] ?? "";
    assert.deepEqual(parseDataRequestFilter(get({ type: "delete", q: "ada" })), { type: "delete", q: "ada" });
    assert.deepEqual(parseDataRequestFilter(get({ type: "drop table" })), { type: "all", q: "" });
    assert.deepEqual(countDataRequests(requests), { all: 3, export: 2, delete: 1 });
  });

  it("exports CSV with labels and neutralized formulas", () => {
    const csv = dataRequestsToCsv(dataRequestRows(requests, [ada, { ...bob, name: "=HYPERLINK(1)" }], { type: "all", q: "" }));
    const lines = csv.split("\r\n");
    assert.equal(lines[0], "Request id,Type,Status,Requested (UTC),Completed (UTC),Member id,Member,Email");
    assert.equal(lines.length, 4);
    assert.ok(lines.some((l) => l.includes("Account deletion") && l.includes(DELETED_USER_NAME)));
    assert.ok(!csv.includes(",=HYPERLINK"), "formula cells are neutralized");
  });
});

describe("privacy actions", () => {
  const password = "correct horse battery";
  let passwordHash = "";

  beforeEach(async () => {
    passwordHash ||= await hashPassword(password);
    const admin = makeUser({ id: "usr_root", roles: ["admin"], passwordHash });
    await resetDb({ ...fixture(), users: [admin, { ...ada, twoFactorEnabled: false, twoFactorSecretEnc: undefined, passwordHash }, bob] });
    resetRequest();
  });

  function form(values: Record<string, string>): FormData {
    const data = new FormData();
    for (const [k, v] of Object.entries(values)) data.set(k, v);
    return data;
  }

  it("refuses a wrong password and a missing confirmation", async () => {
    await createSession(ada.id);
    const wrong = await deleteAccountAction(null, form({ password: "nope", confirm: "DELETE" }));
    assert.equal(wrong.ok, false);
    assert.equal(!wrong.ok && wrong.fieldErrors?.password, "Incorrect password.");
    const unconfirmed = await deleteAccountAction(null, form({ password, confirm: "delete me" }));
    assert.equal(unconfirmed.ok, false);
    assert.ok(!unconfirmed.ok && unconfirmed.fieldErrors?.confirm);
    assert.equal((await getDb()).users.find((u) => u.id === ada.id)!.name, "Ada Lovelace");
  });

  it("erases the account, records the request, audits it and signs out", async () => {
    await createSession(ada.id);
    assert.equal(await captureRedirect(() => deleteAccountAction(null, form({ password, confirm: "delete" }))), "/");
    const db = await getDb();
    assert.ok(isDeletedAccount(db.users.find((u) => u.id === ada.id)!));
    assert.equal(db.sessions.filter((s) => s.userId === ada.id).length, 0);
    const request = db.dataRequests.find((r) => r.userId === ada.id)!;
    assert.equal(request.type, "delete");
    assert.equal(request.status, "completed");
    const event = db.auditEvents.find((e) => e.action === "account.delete")!;
    assert.equal(event.targetId, ada.id);
    assert.equal(event.meta?.byOwner, true);
    assert.ok(db.notifications.some((n) => n.userId === "usr_root" && n.link === "/admin/audit?tab=requests"), "administrators are told");
  });

  it("lets only administrators erase other accounts, never their own", async () => {
    await createSession(bob.id);
    const denied = await adminEraseAccountAction(null, form({ userId: ada.id, password, confirm: "DELETE" }));
    assert.equal(denied.ok, false);

    resetRequest();
    await createSession("usr_root");
    const own = await adminEraseAccountAction(null, form({ userId: "usr_root", password, confirm: "DELETE" }));
    assert.equal(own.ok, false);
    const done = await adminEraseAccountAction(null, form({ userId: ada.id, password, confirm: "DELETE" }));
    assert.equal(done.ok, true);
    const db = await getDb();
    assert.ok(isDeletedAccount(db.users.find((u) => u.id === ada.id)!));
    assert.ok(db.auditEvents.some((e) => e.action === "account.erase" && e.actorId === "usr_root" && e.targetId === ada.id));
    const again = await adminEraseAccountAction(null, form({ userId: ada.id, password, confirm: "DELETE" }));
    assert.equal(again.ok, false, "an erased account can't be erased twice");
  });
});

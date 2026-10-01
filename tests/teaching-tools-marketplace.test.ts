import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { InstructorProfile } from "@/lib/types";
import { creditEarnings, recordInstructorPayouts, reverseEarningsForRefund } from "@/lib/teaching/marketplace";
import {
  applyToTeachAction,
  approveInstructorAction,
  recordInstructorPayoutAction,
  rejectInstructorAction,
  saveMarketplaceSettingsAction,
  updateInstructorTermsAction,
} from "@/lib/actions/marketplace";
import { emit, settleEvents } from "@/lib/events";
import { createSession } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { FIXED_NOW, makeCourse, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

const admin = makeUser({ id: "usr_admin", roles: ["admin"] });
const ada = makeUser({ id: "usr_ada", name: "Ada" });
const bob = makeUser({ id: "usr_bob", name: "Bob", roles: ["student", "course_creator"] });
const staff = makeUser({ id: "usr_staff", name: "Staff" });
const buyer = makeUser({ id: "usr_buyer" });

function profile(userId: string, overrides: Partial<InstructorProfile> = {}): InstructorProfile {
  return { id: `inst_${userId}`, userId, revenueSharePercent: 70, status: "approved", payoutEmail: `${userId}@pay.test`, createdAt: FIXED_NOW, ...overrides };
}

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

async function signIn(userId: string) {
  resetRequest();
  await createSession(userId);
}

const courseA = makeCourse({ id: "crs_a", title: "Course A", price: 10000, paidCourse: true, instructorIds: [ada.id, bob.id, staff.id] });
const courseB = makeCourse({ id: "crs_b", title: "Course B", price: 5000, paidCourse: true, instructorIds: [ada.id] });

async function seed(marketplace = true) {
  await resetDb({
    users: [admin, ada, bob, staff, buyer],
    courses: [courseA, courseB],
    instructorProfiles: [profile(ada.id), profile(bob.id, { revenueSharePercent: 50 }), profile(staff.id, { status: "applied" })],
    bundles: [{ id: "bnd_1", slug: "both", title: "Both", description: "", courseIds: [courseA.id, courseB.id], price: 12000, currency: "USD", published: true } as never],
    payments: [
      makePayment({ id: "pay_a", userId: buyer.id, itemId: courseA.id, status: "paid", amount: 11000, taxAmount: 1000, discountAmount: 500, paidAt: FIXED_NOW }),
      makePayment({ id: "pay_bundle", userId: buyer.id, itemType: "bundle", itemId: "bnd_1", status: "paid", amount: 12000, paidAt: FIXED_NOW }),
      makePayment({ id: "pay_pending", userId: buyer.id, itemId: courseA.id, status: "pending" }),
      makePayment({ id: "pay_self", userId: ada.id, itemId: courseB.id, status: "paid", amount: 5000, paidAt: FIXED_NOW }),
    ],
    settings: { email: { enabled: false }, marketplace: { enabled: marketplace } },
  });
}

describe("teaching-tools marketplace: earnings on payment.paid", () => {
  beforeEach(() => seed());

  it("splits the net (after tax) among approved instructors only, once", async () => {
    const result = await creditEarnings("pay_a");
    assert.ok(result.credited);
    const db = await getDb();
    const rows = db.earnings.filter((e) => e.paymentId === "pay_a");
    // net 10000; two approved instructors -> 5000 each; Ada 70% = 3500, Bob 50% = 2500. Staff only applied.
    assert.deepEqual(
      rows.map((r) => [r.instructorId, r.share, r.gross, r.status]).sort(),
      [
        [ada.id, 3500, 10000, "pending"],
        [bob.id, 2500, 10000, "pending"],
      ],
    );
    assert.deepEqual(await creditEarnings("pay_a"), { credited: false, reason: "exists" });
    assert.equal((await getDb()).earnings.length, 2);
    assert.ok(db.notifications.some((n) => n.userId === ada.id && n.link === "/teach/earnings"));
  });

  it("allocates a bundle across its courses by list price", async () => {
    await creditEarnings("pay_bundle");
    const rows = (await getDb()).earnings.filter((e) => e.paymentId === "pay_bundle");
    const a = rows.filter((r) => r.courseId === courseA.id);
    const b = rows.filter((r) => r.courseId === courseB.id);
    assert.equal(a[0].gross, 8000);
    assert.equal(b[0].gross, 4000);
    assert.equal(b.find((r) => r.instructorId === ada.id)?.share, 2800);
  });

  it("skips unpaid orders, self-purchases and a disabled marketplace", async () => {
    assert.deepEqual(await creditEarnings("pay_pending"), { credited: false, reason: "not_paid" });
    assert.deepEqual(await creditEarnings("pay_self"), { credited: false, reason: "no_instructors" });
    await mutate((d) => {
      d.settings.marketplace.enabled = false;
    });
    assert.deepEqual(await creditEarnings("pay_a"), { credited: false, reason: "disabled" });
  });

  it("is wired to the payment.paid and payment.refunded events", async () => {
    emit("payment.paid", { paymentId: "pay_a", orderId: "ORD-A", userId: buyer.id, itemType: "course", itemId: courseA.id, itemTitle: "Course A", amount: 11000, taxAmount: 1000, discountAmount: 500, currency: "USD", gateway: "stripe" });
    await settleEvents();
    assert.equal((await getDb()).earnings.filter((e) => e.paymentId === "pay_a").length, 2);
    emit("payment.refunded", { paymentId: "pay_a", orderId: "ORD-A", userId: buyer.id, itemType: "course", itemId: courseA.id, amount: 11000, refundedAmount: 11000, currency: "USD", full: true });
    await settleEvents();
    assert.ok((await getDb()).earnings.filter((e) => e.paymentId === "pay_a").every((e) => e.status === "void"));
  });

  it("claws back paid earnings on a refund and deducts them from the next payout", async () => {
    await creditEarnings("pay_a");
    await creditEarnings("pay_bundle");
    const first = await recordInstructorPayouts(admin.id, { instructorIds: [ada.id], currency: "USD", method: "paypal" });
    assert.equal(first.payouts[0].amount, 3500 + 2800 + 2800);
    await reverseEarningsForRefund({ paymentId: "pay_a", orderId: "x", userId: buyer.id, itemType: "course", itemId: courseA.id, amount: 11000, refundedAmount: 5500, currency: "USD", full: false });
    const db = await getDb();
    const correction = db.earnings.find((e) => e.instructorId === ada.id && e.share < 0);
    assert.equal(correction?.share, -1750);
    assert.equal(correction?.status, "pending");
    // Bob's unpaid earning is reduced too, with nothing voided.
    assert.equal(db.earnings.filter((e) => e.instructorId === bob.id && e.paymentId === "pay_a").reduce((s, e) => s + e.share, 0), 1250);
    // Ada has only the correction left: nothing payable.
    const second = await recordInstructorPayouts(admin.id, { instructorIds: [ada.id], currency: "USD", method: "paypal" });
    assert.deepEqual(second.skipped, [ada.id]);
  });
});

describe("teaching-tools marketplace: applications and review", () => {
  beforeEach(() => seed());

  const application = {
    bio: "I build data pipelines for a living and have mentored junior analysts for six years in two different companies.",
    expertise: "SQL, Python",
    sampleUrl: "https://example.com/sample",
    sample: "",
    payoutEmail: "ada@pay.test",
    agree: "1",
  };

  it("lets a member apply, notifies admins and blocks approved instructors", async () => {
    await mutate((d) => {
      d.instructorProfiles = d.instructorProfiles.filter((p) => p.userId !== buyer.id);
    });
    await signIn(buyer.id);
    const res = await applyToTeachAction(null, form(application));
    assert.ok(res.ok, res.ok ? "" : res.error);
    const db = await getDb();
    const p = db.instructorProfiles.find((x) => x.userId === buyer.id);
    assert.equal(p?.status, "applied");
    assert.equal(p?.revenueSharePercent, 70);
    assert.ok(db.notifications.some((n) => n.userId === admin.id && n.link === `/admin/marketplace/${p?.id}`));
    assert.ok(db.auditEvents.some((e) => e.action === "marketplace.apply"));

    await signIn(ada.id);
    const again = await applyToTeachAction(null, form(application));
    assert.ok(!again.ok);
    const missing = await applyToTeachAction(null, form({ ...application, agree: "" }));
    assert.ok(!missing.ok && missing.fieldErrors?.agree);
  });

  it("refuses applications when they are closed", async () => {
    await mutate((d) => {
      d.settings.marketplace.allowApplications = false;
    });
    await signIn(buyer.id);
    const res = await applyToTeachAction(null, form(application));
    assert.ok(!res.ok);
  });

  it("approves with a share and grants the course_creator role; rejects with a reason", async () => {
    await signIn(staff.id);
    assert.ok(!(await approveInstructorAction(null, form({ id: `inst_${staff.id}`, sharePercent: "60" }))).ok);

    await signIn(admin.id);
    assert.ok(!(await approveInstructorAction(null, form({ id: `inst_${staff.id}`, sharePercent: "120" }))).ok);
    const ok = await approveInstructorAction(null, form({ id: `inst_${staff.id}`, sharePercent: "60" }));
    assert.ok(ok.ok);
    let db = await getDb();
    assert.ok(db.users.find((u) => u.id === staff.id)?.roles.includes("course_creator"));
    assert.equal(db.instructorProfiles.find((p) => p.userId === staff.id)?.revenueSharePercent, 60);
    assert.ok(db.notifications.some((n) => n.userId === staff.id && n.subject === "You're approved to teach"));

    assert.ok(!(await rejectInstructorAction(null, form({ id: `inst_${staff.id}`, reason: "no" }))).ok);
    const rejected = await rejectInstructorAction(null, form({ id: `inst_${staff.id}`, reason: "Your sample did not cover the subject." }));
    assert.ok(rejected.ok);
    db = await getDb();
    const p = db.instructorProfiles.find((x) => x.userId === staff.id);
    assert.equal(p?.status, "rejected");
    assert.equal(p?.rejectionReason, "Your sample did not cover the subject.");
    assert.ok(db.auditEvents.some((e) => e.action === "marketplace.reject"));
  });

  it("updates terms and settings (admin only)", async () => {
    await signIn(admin.id);
    const terms = await updateInstructorTermsAction(null, form({ id: `inst_${ada.id}`, sharePercent: "75.5", payoutEmail: "new@pay.test" }));
    assert.ok(terms.ok);
    const settings = await saveMarketplaceSettingsAction(null, form({ enabled: "on", defaultRevenueSharePercent: "65" }));
    assert.ok(settings.ok);
    const db = await getDb();
    assert.equal(db.instructorProfiles.find((p) => p.userId === ada.id)?.revenueSharePercent, 75.5);
    assert.deepEqual(db.settings.marketplace, { enabled: true, allowApplications: false, defaultRevenueSharePercent: 65 });
    await signIn(ada.id);
    assert.ok(!(await saveMarketplaceSettingsAction(null, form({ enabled: "on", defaultRevenueSharePercent: "99" }))).ok);
  });
});

describe("teaching-tools marketplace: payouts", () => {
  beforeEach(async () => {
    await seed();
    await creditEarnings("pay_a");
  });

  it("records one payout per instructor, marks earnings paid and notifies", async () => {
    await signIn(admin.id);
    const res = await recordInstructorPayoutAction(null, form({ instructorId: [ada.id, bob.id, staff.id], currency: "USD", method: "bank_transfer", reference: "TX-1" }));
    assert.ok(res.ok);
    assert.equal(res.ok && res.data.paid, 2);
    const db = await getDb();
    const payouts = db.payouts.filter((p) => p.instructorId);
    assert.deepEqual(payouts.map((p) => [p.instructorId, p.amount]).sort(), [
      [ada.id, 3500],
      [bob.id, 2500],
    ]);
    assert.ok(db.earnings.every((e) => e.status === "paid" && e.paidAt));
    assert.ok(db.notifications.some((n) => n.userId === bob.id && n.subject.startsWith("Payout sent")));
    const again = await recordInstructorPayoutAction(null, form({ instructorId: ada.id, currency: "USD", method: "bank_transfer" }));
    assert.ok(!again.ok);
  });

  it("pays only sales up to the cut-off date", async () => {
    const res = await recordInstructorPayouts(admin.id, { instructorIds: [ada.id], currency: "USD", method: "paypal", through: "2020-01-01" });
    assert.deepEqual(res.skipped, [ada.id]);
  });

  it("validates the request and the caller", async () => {
    await signIn(ada.id);
    assert.ok(!(await recordInstructorPayoutAction(null, form({ instructorId: ada.id, currency: "USD", method: "paypal" }))).ok);
    await signIn(admin.id);
    const bad = await recordInstructorPayoutAction(null, form({ instructorId: "../x", currency: "usd1", method: "cash" }));
    assert.ok(!bad.ok);
    assert.ok(bad.fieldErrors?.method);
  });
});

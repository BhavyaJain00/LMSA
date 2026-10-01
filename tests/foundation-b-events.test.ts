import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { emit, listenerCount, on, settleEvents, isDomainEventName, DOMAIN_EVENT_NAMES, type DomainEvent, type DomainEventName } from "@/lib/events";
import { applyRefund, fulfillPayment, recordGatewayRefund } from "@/lib/payments/fulfillment";
import { enrollUserInCourse } from "@/lib/services/enrollment";
import { issueCertificate, setLessonStatus } from "@/lib/services/progress";
import { recordLead } from "@/lib/services/leads";
import { getDb } from "@/lib/db/store";
import { makeCourse, makeCourseTree, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";

/** Round 3 wave B foundation: the in-process domain event bus and where core flows emit. */

/** Record every event of the given names until the returned `stop` is called. */
function record(...names: DomainEventName[]) {
  const seen: DomainEvent[] = [];
  const offs = names.map((name) => on(name, (event) => void seen.push(event as DomainEvent)));
  return { seen, stop: () => offs.forEach((off) => off()), of: (name: DomainEventName) => seen.filter((e) => e.name === name) };
}

describe("event bus", () => {
  let errors: unknown[][] = [];
  beforeEach(() => {
    errors = [];
    mock.method(console, "error", (...args: unknown[]) => void errors.push(args));
  });
  afterEach(() => mock.restoreAll());

  it("lists the nine domain events", () => {
    assert.deepEqual([...DOMAIN_EVENT_NAMES].sort(), [
      "certificate.issued",
      "course.completed",
      "enrollment.created",
      "lead.created",
      "lesson.completed",
      "payment.paid",
      "payment.refunded",
      "subscription.changed",
      "user.registered",
    ]);
    assert.ok(isDomainEventName("payment.paid"));
    assert.ok(!isDomainEventName("payment.unknown") && !isDomainEventName(42));
  });

  it("delivers an envelope to handlers after emit has returned", async () => {
    const received: DomainEvent<"lead.created">[] = [];
    const off = on("lead.created", (event) => void received.push(event));
    const event = emit("lead.created", { leadId: "lead_1", email: "a@b.test", source: "footer", consent: true });
    assert.equal(received.length, 0, "handlers never run synchronously inside emit");
    await settleEvents();
    off();
    assert.equal(received.length, 1);
    assert.equal(received[0]!.id, event.id);
    assert.match(event.id, /^evt/);
    assert.equal(received[0]!.name, "lead.created");
    assert.equal(received[0]!.data.email, "a@b.test");
    assert.ok(!Number.isNaN(Date.parse(received[0]!.createdAt)));
  });

  it("catches and logs failing handlers without affecting the caller or other handlers", async () => {
    let ran = 0;
    const offs = [
      on("course.completed", () => {
        throw new Error("sync boom");
      }),
      on("course.completed", async () => {
        throw new Error("async boom");
      }),
      on("course.completed", () => void ran++),
    ];
    assert.doesNotThrow(() => emit("course.completed", { enrollmentId: "enr_1", userId: "usr_1", courseId: "crs_1" }));
    await settleEvents();
    offs.forEach((off) => off());
    assert.equal(ran, 1);
    const messages = errors.map((args) => args.map(String).join(" "));
    assert.equal(messages.filter((m) => m.includes("course.completed handler failed")).length, 2);
    assert.ok(messages.some((m) => m.includes("sync boom")) && messages.some((m) => m.includes("async boom")));
    assert.ok(!messages.some((m) => m.includes("usr_1")), "payloads are not logged");
  });

  it("replaces a keyed registration and removes handlers on unsubscribe", async () => {
    const calls: string[] = [];
    // Feature modules may already listen to lesson.completed, so count relative to them.
    const baseline = listenerCount("lesson.completed");
    on("lesson.completed", () => void calls.push("first"), { key: "test:lesson" });
    const off = on("lesson.completed", () => void calls.push("second"), { key: "test:lesson" });
    assert.equal(listenerCount("lesson.completed"), baseline + 1);
    emit("lesson.completed", { userId: "u", courseId: "c", chapterId: "ch", lessonId: "l" });
    await settleEvents();
    assert.deepEqual(calls, ["second"]);
    off();
    assert.equal(listenerCount("lesson.completed"), baseline);
    emit("lesson.completed", { userId: "u", courseId: "c", chapterId: "ch", lessonId: "l" });
    await settleEvents();
    assert.deepEqual(calls, ["second"]);
  });

  it("settles events emitted by handlers too", async () => {
    const seen: string[] = [];
    const offA = on("user.registered", (event) => {
      seen.push("registered");
      emit("lead.created", { leadId: "lead_x", email: event.data.email, source: "signup", consent: false });
    });
    const offB = on("lead.created", () => void seen.push("lead"));
    emit("user.registered", { userId: "usr_x", email: "x@y.test", name: "X", source: "signup" });
    await settleEvents();
    offA();
    offB();
    assert.deepEqual(seen, ["registered", "lead"]);
  });
});

describe("core flows emit domain events", () => {
  const learner = makeUser({ id: "usr_evt", name: "Eve" });
  const paidCourse = makeCourse({ id: "crs_evt_paid", title: "Paid events", price: 5000, paidCourse: true });
  const tree = makeCourseTree([[{ id: "les_evt_1" }, { id: "les_evt_2" }]], { course: { id: "crs_evt_tree", title: "Events 101", enableCertification: true } });
  const order = makePayment({ id: "pay_evt", userId: learner.id, itemId: paidCourse.id, gateway: "stripe", status: "pending", amount: 5000, originalAmount: 5000, itemTitle: "Paid events" });

  before(() => {
    mock.method(console, "info", () => undefined);
  });
  after(() => mock.restoreAll());

  beforeEach(async () => {
    await resetDb({
      users: [learner, makeUser({ id: "usr_admin", roles: ["admin"] })],
      courses: [paidCourse, tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id })],
      payments: [order],
      settings: { email: { enabled: false }, gamification: { enabled: false } },
    });
  });

  it("payment.paid and enrollment.created fire once per order", async () => {
    const rec = record("payment.paid", "enrollment.created");
    assert.ok((await fulfillPayment("pay_evt", "pi_evt1")).ok);
    assert.ok((await fulfillPayment("pay_evt", "pi_evt1")).ok, "a repeated confirmation");
    await settleEvents();
    rec.stop();
    const paid = rec.of("payment.paid") as DomainEvent<"payment.paid">[];
    assert.equal(paid.length, 1);
    assert.deepEqual(
      { id: paid[0]!.data.paymentId, user: paid[0]!.data.userId, type: paid[0]!.data.itemType, item: paid[0]!.data.itemId, amount: paid[0]!.data.amount },
      { id: "pay_evt", user: learner.id, type: "course", item: paidCourse.id, amount: 5000 },
    );
    const enrolled = rec.of("enrollment.created") as DomainEvent<"enrollment.created">[];
    assert.equal(enrolled.length, 1);
    assert.equal(enrolled[0]!.data.courseId, paidCourse.id);
    assert.equal(enrolled[0]!.data.paymentId, "pay_evt");
  });

  it("enrollment.created is not repeated for an existing enrollment", async () => {
    const rec = record("enrollment.created");
    await enrollUserInCourse(learner.id, tree.course.id);
    await enrollUserInCourse(learner.id, paidCourse.id);
    await enrollUserInCourse(learner.id, paidCourse.id);
    await settleEvents();
    rec.stop();
    assert.deepEqual(rec.seen.map((e) => (e as DomainEvent<"enrollment.created">).data.courseId), [paidCourse.id]);
  });

  it("payment.refunded reports partial and full refunds", async () => {
    await fulfillPayment("pay_evt", "pi_evt1");
    await settleEvents();
    const rec = record("payment.refunded");
    await recordGatewayRefund("pay_evt", { refundId: "re_1", amount: 2000 });
    await recordGatewayRefund("pay_evt", { refundId: "re_1", amount: 2000 });
    await recordGatewayRefund("pay_evt", { refundId: "re_2", amount: 3000 });
    await settleEvents();
    rec.stop();
    const refunds = rec.seen as DomainEvent<"payment.refunded">[];
    assert.deepEqual(
      refunds.map((e) => [e.data.full, e.data.refundedAmount]),
      [
        [false, 2000],
        [true, 5000],
      ],
      "the redelivered refund is not reported twice",
    );
  });

  it("payment.refunded fires for an admin refund", async () => {
    await fulfillPayment("pay_evt", "pi_evt1");
    await settleEvents();
    const rec = record("payment.refunded");
    assert.ok((await applyRefund("pay_evt", { amount: 5000 })).ok);
    assert.ok((await applyRefund("pay_evt", { amount: 5000 })).ok);
    await settleEvents();
    rec.stop();
    assert.equal(rec.seen.length, 1);
    assert.equal((rec.seen[0] as DomainEvent<"payment.refunded">).data.full, true);
  });

  it("lesson.completed, course.completed and certificate.issued fire once", async () => {
    const rec = record("lesson.completed", "course.completed", "certificate.issued");
    const [first, second] = tree.lessons;
    await setLessonStatus(learner, first!, "partial");
    await setLessonStatus(learner, first!, "complete");
    await setLessonStatus(learner, first!, "complete");
    await setLessonStatus(learner, second!, "complete");
    await issueCertificate(learner, tree.course);
    await settleEvents();
    rec.stop();
    assert.deepEqual(
      (rec.of("lesson.completed") as DomainEvent<"lesson.completed">[]).map((e) => e.data.lessonId),
      [first!.id, second!.id],
    );
    const completed = rec.of("course.completed") as DomainEvent<"course.completed">[];
    assert.equal(completed.length, 1);
    assert.equal(completed[0]!.data.courseId, tree.course.id);
    const certs = rec.of("certificate.issued") as DomainEvent<"certificate.issued">[];
    assert.equal(certs.length, 1, "auto-issued on completion, not again when issued by hand");
    const db = await getDb();
    assert.equal(certs[0]!.data.code, db.certificates.find((c) => c.userId === learner.id)?.code);
  });

  it("recordLead stores a lead once and emits lead.created for new addresses only", async () => {
    const rec = record("lead.created");
    const first = await recordLead({ email: "  Reader@Example.test ", name: "Reader", source: "blog", consent: false });
    const again = await recordLead({ email: "reader@example.test", source: "footer", courseId: "crs_js", consent: true });
    const invalid = await recordLead({ email: "not-an-email", source: "footer", consent: true });
    await settleEvents();
    rec.stop();
    assert.ok(first.ok && first.created);
    assert.ok(again.ok && !again.created);
    assert.ok(!invalid.ok);
    const db = await getDb();
    assert.equal(db.leads.length, 1);
    assert.deepEqual(
      { email: db.leads[0]!.email, name: db.leads[0]!.name, source: db.leads[0]!.source, courseId: db.leads[0]!.courseId, consent: db.leads[0]!.consent },
      { email: "reader@example.test", name: "Reader", source: "blog", courseId: "crs_js", consent: true },
    );
    assert.equal(rec.seen.length, 1);
    assert.equal((rec.seen[0] as DomainEvent<"lead.created">).data.email, "reader@example.test");
  });
});

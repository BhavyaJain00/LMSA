import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Lead } from "@/lib/types";
import {
  decodeSegmentParam,
  describeSegment,
  encodeSegmentParam,
  evaluateSegment,
  isEmptySegment,
  lastActivityByUser,
  normalizeSegmentFilter,
  segmentCsvRows,
  segmentInputProblem,
  staleSegmentCourses,
  totalExcluded,
  type SegmentSource,
} from "@/lib/comms/segments";
import { makeEnrollment, makePayment, makeUser } from "./helpers/db";

const NOW = Date.parse("2026-06-01T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function lead(overrides: Partial<Lead> & Pick<Lead, "id" | "email">): Lead {
  return { source: "footer", consent: true, confirmedAt: daysAgo(10), createdAt: daysAgo(20), ...overrides };
}

const ada = makeUser({ id: "u_ada", name: "Ada Lovelace", email: "Ada@Example.com", createdAt: daysAgo(400), lastActiveAt: daysAgo(2) });
const bob = makeUser({ id: "u_bob", name: "Bob Stone", email: "bob@example.com", createdAt: daysAgo(400), lastActiveAt: daysAgo(90) });
const cyd = makeUser({ id: "u_cyd", name: "Cyd Rivers", email: "cyd@example.com", roles: ["student", "course_creator"], createdAt: daysAgo(300) });
const dee = makeUser({ id: "u_dee", name: "Dee Off", email: "dee@example.com", emailPreferences: { enrollment: true, announcements: false, liveClasses: true, grading: true, certificates: true, discussions: true, reminders: true, payments: true } });
const eve = makeUser({ id: "u_eve", name: "Eve Disabled", email: "eve@example.com", enabled: false });
const fay = makeUser({ id: "u_fay", name: "Fay New", email: "fay@example.com", emailVerificationRequired: true });
const gus = makeUser({ id: "u_gus", name: "Gus Admin", email: "gus@example.com", roles: ["admin"], createdAt: daysAgo(5) });

function source(overrides: Partial<SegmentSource> = {}): SegmentSource {
  return {
    users: [ada, bob, cyd, dee, eve, fay, gus],
    enrollments: [
      makeEnrollment({ userId: ada.id, courseId: "c_py" }),
      makeEnrollment({ userId: bob.id, courseId: "c_js" }),
      makeEnrollment({ userId: cyd.id, courseId: "c_py" }),
      makeEnrollment({ userId: cyd.id, courseId: "c_js" }),
    ],
    payments: [makePayment({ userId: ada.id, itemId: "c_py", status: "paid" }), makePayment({ userId: bob.id, itemId: "c_js", status: "refunded" })],
    leads: [
      lead({ id: "l_1", email: "lena@example.com", name: "Lena Lead", courseId: "c_py" }),
      lead({ id: "l_2", email: "pending@example.com", confirmedAt: undefined }),
      lead({ id: "l_3", email: "gone@example.com", unsubscribedAt: daysAgo(1) }),
      lead({ id: "l_4", email: "ada@example.com", name: "Ada as a lead" }),
      lead({ id: "l_5", email: "noconsent@example.com", consent: false }),
      lead({ id: "l_6", email: "LENA@example.com", name: "Lena again" }),
    ],
    activities: [{ userId: cyd.id, createdAt: daysAgo(1) }],
    progress: [{ userId: bob.id, updatedAt: daysAgo(40) }],
    ...overrides,
  };
}

const emails = (result: ReturnType<typeof evaluateSegment>) => result.recipients.map((r) => r.email);

describe("segment evaluation", () => {
  it("an empty filter reaches every eligible member and explains who is left out", () => {
    const result = evaluateSegment(source(), {}, NOW);
    assert.deepEqual(emails(result), ["ada@example.com", "bob@example.com", "cyd@example.com", "gus@example.com"]);
    assert.deepEqual(result.excluded, { unsubscribed: 1, disabled: 1, unconfirmed: 1, invalid: 0, duplicate: 0 });
    assert.equal(totalExcluded(result.excluded), 3);
    assert.equal(result.recipients[0]!.firstName, "Ada");
    assert.equal(result.recipients[0]!.kind, "member");
  });

  it("enrolled in any of / not enrolled in", () => {
    assert.deepEqual(emails(evaluateSegment(source(), { courseIds: ["c_py"] }, NOW)), ["ada@example.com", "cyd@example.com"]);
    assert.deepEqual(emails(evaluateSegment(source(), { courseIds: ["c_py", "c_js"] }, NOW)), ["ada@example.com", "bob@example.com", "cyd@example.com"]);
    assert.deepEqual(emails(evaluateSegment(source(), { notEnrolledCourseIds: ["c_js"] }, NOW)), ["ada@example.com", "gus@example.com"]);
    assert.deepEqual(emails(evaluateSegment(source(), { courseIds: ["c_py"], notEnrolledCourseIds: ["c_js"] }, NOW)), ["ada@example.com"]);
  });

  it("roles match literally (an admin is not a student)", () => {
    assert.deepEqual(emails(evaluateSegment(source(), { roles: ["course_creator"] }, NOW)), ["cyd@example.com"]);
    assert.deepEqual(emails(evaluateSegment(source(), { roles: ["student"] }, NOW)), ["ada@example.com", "bob@example.com", "cyd@example.com"]);
    assert.deepEqual(emails(evaluateSegment(source(), { roles: ["admin"] }, NOW)), ["gus@example.com"]);
  });

  it("purchased counts paid orders only; refunds don't count", () => {
    assert.deepEqual(emails(evaluateSegment(source(), { purchased: true }, NOW)), ["ada@example.com"]);
    assert.deepEqual(emails(evaluateSegment(source(), { purchased: false }, NOW)), ["bob@example.com", "cyd@example.com", "gus@example.com"]);
  });

  it("inactivity uses the latest of sign-up, last activity, activity log and lesson progress", () => {
    // bob: lastActiveAt 90 days ago but lesson progress 40 days ago; cyd: activity yesterday; gus: signed up 5 days ago.
    assert.deepEqual(emails(evaluateSegment(source(), { inactiveDays: 30 }, NOW)), ["bob@example.com"]);
    assert.deepEqual(emails(evaluateSegment(source(), { inactiveDays: 60 }, NOW)), []);
    assert.deepEqual(emails(evaluateSegment(source(), { inactiveDays: 3 }, NOW)), ["bob@example.com", "gus@example.com"]);
    const last = lastActivityByUser(source());
    assert.equal(last.get(cyd.id), Date.parse(daysAgo(1)));
    assert.equal(last.get(bob.id), Date.parse(daysAgo(40)));
  });

  it("conditions combine with AND and exclusions only count people who match", () => {
    const result = evaluateSegment(source(), { courseIds: ["c_js"], purchased: false, roles: ["student"] }, NOW);
    assert.deepEqual(emails(result), ["bob@example.com", "cyd@example.com"]);
    assert.equal(totalExcluded(result.excluded), 0);
  });

  it("leads: consent, double opt-in and unsubscribes are respected; members and duplicates are dropped", () => {
    const result = evaluateSegment(source(), { leadsOnly: true }, NOW);
    assert.deepEqual(emails(result), ["lena@example.com"]);
    assert.equal(result.recipients[0]!.kind, "lead");
    assert.equal(result.recipients[0]!.firstName, "Lena");
    assert.deepEqual(result.excluded, { unsubscribed: 1, disabled: 0, unconfirmed: 2, invalid: 0, duplicate: 1 });
  });

  it("leads can be narrowed to the course they showed interest in", () => {
    assert.deepEqual(emails(evaluateSegment(source(), { leadsOnly: true, courseIds: ["c_py"] }, NOW)), ["lena@example.com"]);
    assert.deepEqual(emails(evaluateSegment(source(), { leadsOnly: true, courseIds: ["c_js"] }, NOW)), []);
  });

  it("invalid addresses and duplicate member addresses are excluded", () => {
    const twin = makeUser({ id: "u_twin", name: "Ada Twin", email: " ada@example.com " });
    const broken = makeUser({ id: "u_broken", name: "Broken", email: "not-an-email" });
    const result = evaluateSegment(source({ users: [ada, twin, broken] }), {}, NOW);
    assert.deepEqual(emails(result), ["ada@example.com"]);
    assert.equal(result.excluded.duplicate, 1);
    assert.equal(result.excluded.invalid, 1);
  });

  it("a verified account that required verification is included", () => {
    const verified = { ...fay, emailVerifiedAt: daysAgo(1) };
    assert.deepEqual(emails(evaluateSegment(source({ users: [verified] }), {}, NOW)), ["fay@example.com"]);
  });
});

describe("segment filter normalization", () => {
  it("drops unknown keys, bad ids and roles, and clamps days", () => {
    const f = normalizeSegmentFilter({
      courseIds: ["c_py", "c_py", "bad id", 42, "c_js"],
      notEnrolledCourseIds: ["c_js", "c_go"],
      roles: ["student", "root", "admin"],
      inactiveDays: "99999",
      purchased: "yes",
      extra: true,
    });
    assert.deepEqual(f, { courseIds: ["c_py", "c_js"], notEnrolledCourseIds: ["c_go"], roles: ["student", "admin"], inactiveDays: 3650 });
  });

  it("limits course ids to known courses", () => {
    assert.deepEqual(normalizeSegmentFilter({ courseIds: ["c_py", "c_gone"] }, new Set(["c_py"])), { courseIds: ["c_py"] });
  });

  it("a leads segment keeps only the course interest", () => {
    assert.deepEqual(normalizeSegmentFilter({ leadsOnly: true, courseIds: ["c_py"], roles: ["student"], inactiveDays: 5, purchased: true }), {
      courseIds: ["c_py"],
      leadsOnly: true,
    });
  });

  it("rejects non-objects and non-positive days", () => {
    assert.deepEqual(normalizeSegmentFilter(null), {});
    assert.deepEqual(normalizeSegmentFilter(["x"]), {});
    assert.deepEqual(normalizeSegmentFilter({ inactiveDays: 0 }), {});
    assert.equal(isEmptySegment({}), true);
    assert.equal(isEmptySegment({ purchased: false }), false);
    assert.equal(isEmptySegment({ leadsOnly: true }), false);
  });

  it("round-trips through the URL parameter and refuses garbage", () => {
    const filter = { courseIds: ["c_py"], roles: ["student" as const], inactiveDays: 30, purchased: false };
    const encoded = encodeSegmentParam(filter);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeSegmentParam(encoded), filter);
    assert.deepEqual(decodeSegmentParam("%%%"), {});
    assert.deepEqual(decodeSegmentParam("bm90IGpzb24"), {});
    assert.deepEqual(decodeSegmentParam(undefined), {});
  });
});

describe("segment descriptions and CSV", () => {
  const titles = new Map([
    ["c_py", "Python 101"],
    ["c_js", "JavaScript"],
  ]);
  const titleOf = (id: string) => titles.get(id);

  it("describes member and lead segments", () => {
    assert.deepEqual(describeSegment({}, titleOf), ["All members"]);
    assert.deepEqual(describeSegment({ roles: ["student"], courseIds: ["c_py", "c_js"], notEnrolledCourseIds: ["c_gone"], inactiveDays: 30, purchased: false }, titleOf), [
      "Students",
      "Enrolled in any of Python 101, JavaScript",
      "Not enrolled in a deleted course",
      "Inactive for 30+ days",
      "Never purchased",
    ]);
    assert.deepEqual(describeSegment({ leadsOnly: true, courseIds: ["c_py"] }, titleOf), ["Leads without an account", "Interested in Python 101"]);
  });

  it("exports one row per recipient", () => {
    const result = evaluateSegment(source(), { courseIds: ["c_py"] }, NOW);
    assert.deepEqual(segmentCsvRows(result.recipients), [
      ["Email", "Name", "Type"],
      ["ada@example.com", "Ada Lovelace", "Member"],
      ["cyd@example.com", "Cyd Rivers", "Member"],
    ]);
  });
});

describe("audience input fails closed", () => {
  const known = new Set(["crs_a", "crs_b"]);

  it("accepts filters whose courses all exist, including the empty filter", () => {
    assert.equal(segmentInputProblem({}, known), null);
    assert.equal(segmentInputProblem({ courseIds: ["crs_a"], notEnrolledCourseIds: ["crs_b"], roles: ["student"] }, known), null);
  });

  it("rejects input that isn't a filter object", () => {
    for (const raw of [null, undefined, "", "{}", 0, [], [{ courseIds: [] }], { courseIds: "crs_a" }, { notEnrolledCourseIds: { a: 1 } }]) {
      assert.match(segmentInputProblem(raw, known) ?? "", /couldn't be read/, JSON.stringify(raw));
    }
  });

  it("rejects courses that no longer exist instead of dropping them", () => {
    assert.match(segmentInputProblem({ courseIds: ["crs_gone"] }, known) ?? "", /no longer exists/);
    assert.match(segmentInputProblem({ courseIds: ["crs_a", "crs_gone"] }, known) ?? "", /no longer exists/);
    assert.match(segmentInputProblem({ notEnrolledCourseIds: ["crs_gone"] }, known) ?? "", /no longer exists/);
    assert.match(segmentInputProblem({ courseIds: [42] }, known) ?? "", /no longer exists/);
  });

  it("counts stale course conditions of a stored filter", () => {
    assert.equal(staleSegmentCourses({ courseIds: ["crs_a"], notEnrolledCourseIds: ["crs_b"] }, known), 0);
    assert.equal(staleSegmentCourses({ courseIds: ["crs_a", "crs_gone"], notEnrolledCourseIds: ["crs_old"] }, known), 2);
    assert.equal(staleSegmentCourses({}, known), 0);
  });
});

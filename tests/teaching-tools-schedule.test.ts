import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEDULE_LIMITS,
  coursePublishState,
  fromLocalInputValue,
  isCourseLive,
  isLessonLive,
  parsePublishAt,
  planPublishSweep,
  publishTime,
  sweepHasWork,
  toLocalInputValue,
} from "@/lib/teaching/schedule-shared";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const PAST = "2026-10-01T11:00:00.000Z";
const FUTURE = "2026-10-02T09:30:00.000Z";

type CourseRow = Parameters<typeof planPublishSweep>[0][number];

const course = (id: string, patch: Partial<CourseRow> = {}): CourseRow => ({ id, published: false, status: "approved", ...patch });

describe("teaching-tools schedule: publishAt visibility", () => {
  it("reads the publish time and ignores a missing or unreadable one", () => {
    assert.equal(publishTime({}), null);
    assert.equal(publishTime({ publishAt: "not a date" }), null);
    assert.equal(publishTime({ publishAt: PAST }), Date.parse(PAST));
  });

  it("classifies a course by its flag, schedule and approval", () => {
    assert.equal(coursePublishState(course("c", { published: true }), NOW), "live");
    assert.equal(coursePublishState(course("c"), NOW), "draft");
    assert.equal(coursePublishState(course("c", { publishAt: FUTURE }), NOW), "scheduled");
    assert.equal(coursePublishState(course("c", { publishAt: PAST }), NOW), "due");
    assert.equal(coursePublishState(course("c", { publishAt: PAST, status: "in_progress" }), NOW), "held");
  });

  it("shows a course from the moment its publish time passes", () => {
    const scheduled = course("c", { publishAt: FUTURE });
    const at = Date.parse(FUTURE);
    assert.equal(isCourseLive(scheduled, at - 1), false);
    assert.equal(isCourseLive(scheduled, at), true);
    assert.equal(isCourseLive(course("c"), NOW), false);
    assert.equal(isCourseLive(course("c", { published: true, publishAt: FUTURE }), NOW), true);
    assert.equal(isCourseLive(course("c", { publishAt: PAST, status: "in_progress" }), NOW), false);
  });

  it("hides a lesson only while its publish time is ahead", () => {
    assert.equal(isLessonLive({}, NOW), true);
    assert.equal(isLessonLive({ publishAt: PAST }, NOW), true);
    assert.equal(isLessonLive({ publishAt: FUTURE }, NOW), false);
    assert.equal(isLessonLive({ publishAt: FUTURE }, Date.parse(FUTURE)), true);
  });
});

describe("teaching-tools schedule: publish sweep plan", () => {
  it("publishes due courses, clears leftovers, releases due lessons and reports the next time", () => {
    const plan = planPublishSweep(
      [
        course("due", { publishAt: PAST }),
        course("later", { publishAt: FUTURE }),
        course("by-hand", { published: true, publishAt: FUTURE }),
        course("held", { publishAt: PAST, status: "in_progress" }),
        course("draft"),
      ],
      [{ id: "l-due", publishAt: PAST }, { id: "l-later", publishAt: "2026-10-01T18:00:00.000Z" }, { id: "l-plain" }],
      NOW,
    );
    assert.deepEqual(plan.publish, ["due"]);
    assert.deepEqual(plan.clear, ["by-hand"]);
    assert.deepEqual(plan.release, ["l-due"]);
    assert.equal(plan.nextAt, Date.parse("2026-10-01T18:00:00.000Z"));
    assert.equal(sweepHasWork(plan), true);
  });

  it("has nothing left once the publish times are removed (exactly once)", () => {
    const plan = planPublishSweep([course("due", { published: true }), course("later", { publishAt: FUTURE })], [{ id: "l-due" }], NOW);
    assert.equal(sweepHasWork(plan), false);
    assert.equal(plan.nextAt, Date.parse(FUTURE));
  });
});

describe("teaching-tools schedule: form input", () => {
  it("accepts a future instant and rounds it down to the minute", () => {
    const parsed = parsePublishAt("2026-10-02T09:30:42.500Z", NOW);
    assert.deepEqual(parsed, { ok: true, iso: "2026-10-02T09:30:00.000Z", at: Date.parse("2026-10-02T09:30:00.000Z") });
  });

  it("rejects empty, unreadable, past and far-future values", () => {
    assert.equal(parsePublishAt("", NOW).ok, false);
    assert.equal(parsePublishAt(undefined, NOW).ok, false);
    assert.equal(parsePublishAt("tomorrow-ish", NOW).ok, false);
    assert.equal(parsePublishAt(PAST, NOW).ok, false);
    assert.equal(parsePublishAt(new Date(NOW + SCHEDULE_LIMITS.minLeadMs - 1).toISOString(), NOW).ok, false);
    assert.equal(parsePublishAt(new Date(NOW + SCHEDULE_LIMITS.maxAheadMs + 60_000).toISOString(), NOW).ok, false);
  });

  it("round-trips a datetime-local value in the local time zone", () => {
    const minute = Math.floor(NOW / 60_000) * 60_000;
    assert.equal(fromLocalInputValue(toLocalInputValue(minute)), minute);
    assert.equal(fromLocalInputValue(""), null);
    assert.equal(fromLocalInputValue("2026-02-31T10:00"), null);
    assert.equal(toLocalInputValue(Number.NaN), "");
  });
});

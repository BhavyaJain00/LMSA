import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeMediaAccess, canPlayLessonMedia, lessonReferencesPath } from "@/lib/media/access";
import { makeCourseTree, makeEnrollment, makeUser, resetDb } from "./helpers/db";

/** Secure-video review: finding 1 (second path, staff signing a case variant) and finding 5 (free-preview locks). */

const VIDEO = "/uploads/videos/intro-abc.mp4";

describe("media authorization", () => {
  it("free-preview playback follows getLessonAccess (drip and order locks apply)", () => {
    assert.equal(canPlayLessonMedia({ manager: false, canView: false }), false);
    assert.equal(canPlayLessonMedia({ manager: false, canView: true }), true);
    assert.equal(canPlayLessonMedia({ manager: true, canView: false }), true);
  });

  it("matches lesson references case-insensitively, so staff cannot sign a case variant as 'unreferenced'", async () => {
    const instructor = makeUser({ id: "usr_sv_instructor", roles: ["course_creator"] });
    const otherCreator = makeUser({ id: "usr_sv_creator", roles: ["course_creator"] });
    const learner = makeUser({ id: "usr_sv_learner" });
    const tree = makeCourseTree([[{ blocks: [{ id: "blk_sv_video", type: "video", src: VIDEO, duration: 600 }] }]], { course: { instructorIds: [instructor.id] } });
    await resetDb({
      users: [instructor, otherCreator, learner],
      courses: [tree.course],
      chapters: tree.chapters,
      lessons: tree.lessons,
      enrollments: [makeEnrollment({ userId: learner.id, courseId: tree.course.id })],
    });

    assert.equal(lessonReferencesPath(tree.lessons[0]!, "/uploads/Videos/INTRO-ABC.MP4"), true);
    const variant = await authorizeMediaAccess(otherCreator, "/uploads/Videos/INTRO-ABC.MP4");
    assert.equal(variant.ok, false);
    assert.equal((await authorizeMediaAccess(learner, "/uploads/VIDEOS/intro-abc.mp4")).ok, true);
    assert.equal((await authorizeMediaAccess(instructor, "/uploads/videos/INTRO-abc.mp4")).ok, true);
    // Unreferenced fresh uploads stay signable for staff.
    assert.equal((await authorizeMediaAccess(otherCreator, "/uploads/videos/fresh-upload-0123456789abcdef.mp4")).ok, true);
  });

  it("does not sign a scheduled free-preview video before its release date", async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const tree = makeCourseTree([[{ includeInPreview: true, availableFrom: future, blocks: [{ id: "blk_sv_prev", type: "video", src: "/uploads/videos/preview-abc.mp4" }] }]]);
    const visitor = makeUser({ id: "usr_sv_visitor" });
    await resetDb({ users: [visitor], courses: [tree.course], chapters: tree.chapters, lessons: tree.lessons, settings: { learning: { allowGuestAccess: true } } });
    for (const viewer of [null, visitor]) {
      const decision = await authorizeMediaAccess(viewer, "/uploads/videos/preview-abc.mp4", { lessonId: tree.lessons[0]!.id });
      assert.equal(decision.ok, false);
    }
  });
});

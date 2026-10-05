import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ChapterWithLessons, Course, PublicUser, Review, User } from "@/lib/types";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { courseTutorAccess } from "@/lib/ai/access";
import {
  canManageCourse,
  canViewCourse,
  getCourseBySlug,
  getCourseOutline,
  getCourseProgress,
  getCourseReviews,
  getEnrollment,
  getNextLesson,
  getRatingBreakdown,
  lessonHref,
} from "@/lib/data/courses";
import {
  getBatchesForCourse,
  getCourseAnnouncements,
  getCourseContentStats,
  getInstructorStats,
  getRelatedCourses,
  getUserCourseCertificate,
  getCourseSummaryForViewer,
  hasPaidForCourse,
} from "@/lib/data/catalog";
import { getPublicUser } from "@/lib/data/users";
import { ensureDripNotifications } from "@/lib/services/drip";
import { Icon } from "@/components/ui/icons";
import { CourseHero } from "@/components/catalog/course-hero";
import { CourseOutline } from "@/components/catalog/course-outline";
import { EnrollCard, type CourseIncludes, type EnrollCardEnrollment } from "@/components/catalog/enroll-card";
import { CourseInstructors } from "@/components/catalog/course-instructors";
import { ReviewsPanel } from "@/components/catalog/reviews-panel";
import {
  CertificationCard,
  CourseAnnouncements,
  CourseBatches,
  CourseDescription,
  CourseOutcomes,
  CourseRequirements,
  RelatedCourses,
  SectionHeading,
} from "@/components/catalog/course-sections";
import { lessonKindFromBlocks, reviewDateLabel } from "@/components/catalog/format";
import type { OutlineChapterView, OutlineMode, ReviewView } from "@/components/catalog/types";
import { sum } from "@/lib/utils";
import { getFormatter, getLocale, getT } from "@/i18n/server";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { splitKeywords } from "@/lib/seo/text";
import { isCoursePublic } from "@/lib/seo/visibility";
import { coursePath } from "@/lib/seo/content-index";
import { courseTrail } from "@/lib/seo/breadcrumbs";
import { getCourseJsonLd } from "@/lib/data/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { CourseArticles } from "@/components/marketing/course-articles";
import { LeadForm } from "@/components/marketing/lead-form";
import { SalesHero } from "@/components/marketing/sales/sales-hero";
import { ENROLL_ANCHOR, SalesSections } from "@/components/marketing/sales/sales-sections";
import { isPaidCourse } from "@/components/catalog/price-tag";
import { hasSalesPage } from "@/lib/seo/sales-page";
import { privacyPolicyHref } from "@/lib/seo/lead-capture";
import { coursePreviewPlayback } from "@/lib/media/course-preview";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toOutlineView(course: Course, outline: ChapterWithLessons[]): OutlineChapterView[] {
  return outline.map((chapter, index) => ({
    id: chapter.id,
    title: chapter.title,
    description: chapter.description,
    number: index + 1,
    durationSeconds: sum(chapter.lessons.map((l) => l.durationSeconds)),
    completedCount: chapter.lessons.filter((l) => l.status === "complete").length,
    lessons: chapter.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      chapterNumber: lesson.chapterNumber,
      lessonNumber: lesson.lessonNumber,
      kind: lessonKindFromBlocks(lesson.blocks),
      durationSeconds: lesson.durationSeconds,
      preview: lesson.includeInPreview,
      locked: lesson.locked,
      status: lesson.status,
      href: lesson.locked ? null : lessonHref(course.slug, lesson),
    })),
  }));
}

/** The time this request is rendered at (the first frame of the sales-page countdown). */
function requestTime(): number {
  return Date.now();
}

type ReviewWithUser = Review & { user: PublicUser | null };

function toReviewViews(reviews: ReviewWithUser[], viewerId: string | null, locale: string): ReviewView[] {
  const now = Date.now();
  return reviews
    .filter((r): r is Review & { user: PublicUser } => !!r.user)
    .map((r) => ({
      id: r.id,
      rating: r.rating,
      review: r.review,
      createdAt: r.createdAt,
      dateLabel: reviewDateLabel(r.createdAt, now, locale),
      author: { id: r.user.id, name: r.user.name, username: r.user.username, avatarUrl: r.user.avatarUrl },
      isOwn: !!viewerId && r.userId === viewerId,
    }));
}

function reviewHint(
  t: Translator<MessageKey<"public">>,
  opts: { user: User | null; enrolled: boolean; instructor: boolean; hasOwn: boolean; upcoming: boolean },
): string | null {
  if (opts.instructor || opts.hasOwn) return null;
  if (!opts.user) return t("reviews.hint.guest");
  if (!opts.enrolled) return opts.upcoming ? t("reviews.hint.upcoming") : t("reviews.hint.enroll");
  return null;
}

/* ------------------------------------------------------------------ */
/* Metadata                                                            */
/* ------------------------------------------------------------------ */

export async function generateMetadata(props: PageProps<"/courses/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [course, user, settings, t, locale] = await Promise.all([getCourseBySlug(slug), getCurrentUser(), getSettings(), getT("public"), getLocale()]);
  const enrolled = course && user && !course.published ? !!(await getEnrollment(user.id, course.id)) : false;
  if (!course || !(canViewCourse(user, course) || enrolled)) return notFoundMetadata(t("course.notFound"));
  const custom = course.metaDescription?.trim();
  return pageMetadata(
    {
      title: course.seoTitle?.trim() || course.title,
      description: custom || [course.shortIntroduction, course.description],
      path: coursePath(course.slug),
      // An uploaded share image wins; otherwise the generated card (./opengraph-image.tsx) is used.
      image: course.ogImageUrl ? { url: course.ogImageUrl, alt: course.title } : undefined,
      generatedImage: !course.ogImageUrl,
      keywords: splitKeywords(course.metaKeywords, course.tags),
      // Drafts, scheduled courses and a switched-off catalog stay out of the index.
      noindex: !isCoursePublic(course) || !settings.features.courses,
      locale,
    },
    settings,
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function CoursePage(props: PageProps<"/courses/[slug]">) {
  const { slug } = await props.params;
  const [user, settings, course, t, f] = await Promise.all([getCurrentUser(), getSettings(), getCourseBySlug(slug), getT("public"), getFormatter()]);
  if (!course) notFound();

  const manager = canManageCourse(user, course);
  // Unpublished courses stay visible to their managers and to members already enrolled
  // (same rule as the lesson player layout), so enrolled learners are not sent to a 404.
  const enrollment = await getEnrollment(user?.id, course.id);
  if (!course.published && !manager && !enrollment) notFound();
  if (!settings.features.courses && !manager) notFound();
  if (!user && !settings.learning.allowGuestAccess) redirect(`/login?next=${encodeURIComponent(`/courses/${course.slug}`)}`);
  // No scheduler: announce drip content released since the learner's last visit (never throws).
  if (user && enrollment) await ensureDripNotifications(user.id);

  const [summary, outline, reviews, breakdown, related, content, announcements, certificate, batches, alreadyPaid, instructorStats, evaluator] =
    await Promise.all([
      getCourseSummaryForViewer(course.id, user, !!enrollment),
      getCourseOutline(course, user),
      settings.features.reviews ? getCourseReviews(course.id) : Promise.resolve([] as ReviewWithUser[]),
      getRatingBreakdown(course.id),
      getRelatedCourses(course, user, 4),
      getCourseContentStats(course.id),
      getCourseAnnouncements(course.id, 5),
      getUserCourseCertificate(user?.id, course.id),
      settings.features.batches ? getBatchesForCourse(course.id, 3) : Promise.resolve([]),
      hasPaidForCourse(user?.id, course.id),
      getInstructorStats(course.instructorIds),
      course.paidCertificate && course.evaluatorId ? getPublicUser(course.evaluatorId) : Promise.resolve(null),
    ]);
  if (!summary) notFound();

  const [progress, nextLesson] = await Promise.all([
    user && enrollment ? getCourseProgress(user.id, course.id) : Promise.resolve(null),
    user && (enrollment || manager) ? getNextLesson(course, user) : Promise.resolve(null),
  ]);

  const mode: OutlineMode = manager ? "manager" : enrollment ? "enrolled" : user ? "visitor" : "guest";
  const chapters = toOutlineView(course, outline);
  const lessonCount = sum(chapters.map((c) => c.lessons.length));
  const nextChapterId = nextLesson ? outline.find((c) => c.lessons.some((l) => l.id === nextLesson.id))?.id : undefined;
  const defaultOpenIds = nextChapterId && mode === "enrolled" ? [nextChapterId] : chapters[0] ? [chapters[0].id] : [];

  const firstLesson = outline.flatMap((c) => c.lessons)[0] ?? null;
  const enrollmentView: EnrollCardEnrollment | null =
    enrollment && progress
      ? {
          progress: progress.percent,
          completedLessons: progress.completedLessons,
          totalLessons: progress.totalLessons,
          completed: progress.completed,
          canLeave: !enrollment.batchId && !enrollment.paymentId && !enrollment.certificateId,
          purchasedCertificate: enrollment.purchasedCertificate,
          viaBatch: !!enrollment.batchId,
        }
      : null;

  const includes: CourseIncludes = {
    enrolledCount: summary.enrollmentCount,
    lessonCount,
    totalDurationSeconds: summary.totalDurationSeconds,
    videoSeconds: content.videoSeconds,
    hasVideo: !!course.videoUrl || content.videoLessonCount > 0,
    quizCount: content.quizCount,
    assignmentCount: content.assignmentCount,
    exerciseCount: content.exerciseCount,
    previewCount: content.previewLessonCount,
  };

  const reviewViews = toReviewViews(reviews, user?.id ?? null, f.locale);
  const hasOwnReview = reviewViews.some((r) => r.isOwn);
  const isInstructor = !!user && course.instructorIds.includes(user.id);
  const canWriteReview = settings.features.reviews && !!user && !!enrollment && !hasOwnReview && !isInstructor;
  const certificationsEnabled = settings.features.certifications;
  // The AI tutor's full page: enrolled learners (with access) and course staff, once the tutor is set up.
  const askAi = !!user && (manager || !!enrollmentView) && courseTutorAccess(await getDb(), course, user).ok;

  const enrollCard = (
    <EnrollCard
      course={course}
      manager={manager}
      enrollment={enrollmentView}
      nextLesson={nextLesson ? { href: lessonHref(course.slug, nextLesson), title: nextLesson.title } : null}
      firstLessonHref={firstLesson ? lessonHref(course.slug, firstLesson) : null}
      certificate={certificate ? { code: certificate.code } : null}
      alreadyPaid={alreadyPaid}
      batches={batches.map((b) => ({ slug: b.slug, title: b.title, startDate: b.startDate }))}
      includes={includes}
      certificationsEnabled={certificationsEnabled}
      askAiHref={askAi ? `/courses/${course.slug}/ask` : null}
    />
  );

  const showCertification = certificationsEnabled && (course.enableCertification || course.paidCertificate || !!certificate);
  const salesPage = hasSalesPage(course.salesPage) ? course.salesPage : null;
  // The preview's HLS stream (adaptive streaming) once converted; the uploaded file stays the fallback.
  const preview = coursePreviewPlayback(course);
  const previewVideo = preview ? { url: preview.src, poster: preview.poster, hlsUrl: preview.hlsUrl } : null;
  // "Get the syllabus by email" for visitors who are not learners of a public course yet.
  const offerSyllabus = isCoursePublic(course) && !enrollment && !manager && lessonCount > 0;
  const serverNow = requestTime();

  const curriculumBody = (
    <>
      {chapters.length && lessonCount ? (
        <CourseOutline chapters={chapters} mode={mode} defaultOpenIds={defaultOpenIds} nextLessonId={enrollment ? (nextLesson?.id ?? null) : null} />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-10 text-center">
          <Icon.BookOpen className="size-7 text-ink-faint" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-ink-muted">{t("course.contentComingSoon")}</p>
        </div>
      )}
      {mode === "guest" && content.previewLessonCount > 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <Icon.Eye className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <span>{t.rich("course.previewNote", { b: (chunks) => <span className="font-medium text-ink">{chunks}</span> })}</span>
        </p>
      )}
    </>
  );

  const syllabusForm = offerSyllabus ? (
    <LeadForm
      source="course"
      courseId={course.id}
      title={t("course.syllabus.title")}
      description={t("course.syllabus.description", { title: course.title })}
      submitLabel={t("course.syllabus.submit")}
      privacyHref={await privacyPolicyHref()}
    />
  ) : null;

  const certificationBlock =
    showCertification || batches.length > 0 ? (
      <div className="grid gap-5 md:grid-cols-2">
        {showCertification && (
          <CertificationCard
            slug={course.slug}
            enableCertification={course.enableCertification}
            paidCertificate={course.paidCertificate}
            certificatePrice={course.certificatePrice}
            currency={course.currency}
            evaluatorName={evaluator?.name}
            certificate={certificate ? { code: certificate.code, issueDate: certificate.issueDate } : null}
            lessonCount={lessonCount}
          />
        )}
        <CourseBatches batches={batches} />
      </div>
    ) : null;

  const reviewsBlock = settings.features.reviews ? (
    <section id="reviews" aria-label={t("reviews.title")} className="scroll-mt-20">
      <ReviewsPanel
        courseSlug={course.slug}
        courseTitle={course.title}
        summary={breakdown}
        reviews={reviewViews}
        canWrite={canWriteReview}
        writeHint={reviewHint(t, { user, enrolled: !!enrollment, instructor: isInstructor, hasOwn: hasOwnReview, upcoming: course.upcoming })}
        canModerate={isModerator(user)}
      />
    </section>
  ) : null;

  const handsOn = content.assignmentCount + content.exerciseCount;
  const salesIncludes = salesPage
    ? [
        lessonCount > 0
          ? summary.totalDurationSeconds > 0
            ? t("course.salesIncludes.lessonsTotal", { count: lessonCount, duration: f.duration(summary.totalDurationSeconds) })
            : t("catalog.lessonCount", { count: lessonCount })
          : "",
        content.quizCount > 0 ? t("course.salesIncludes.quizzes", { count: content.quizCount }) : "",
        handsOn > 0 ? t("course.salesIncludes.handsOn", { count: handsOn }) : "",
        showCertification ? (course.paidCertificate ? t("enroll.includes.certificateEvaluation") : t("enroll.includes.certificateCompletion")) : "",
        content.previewLessonCount > 0 ? t("enroll.includes.previews", { count: content.previewLessonCount }) : "",
        t("course.salesIncludes.anyDevice"),
      ].filter(Boolean)
    : [];
  const salesAction = enrollment ? t("enroll.continueLearning") : isPaidCourse(course) && !alreadyPaid ? t("course.getCourse") : t("course.enrollNow");

  return (
    <div className="animate-fade-in pb-6">
      {isCoursePublic(course) && <JsonLd data={await getCourseJsonLd(course, summary)} />}
      <Breadcrumbs items={courseTrail(course, summary.category)} structuredData={isCoursePublic(course)} />

      {!course.published && manager && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.EyeOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-medium">{t("course.unpublished.title")}</span>{" "}
            <span className="text-ink-muted">{t("course.unpublished.body")}</span>
          </p>
        </div>
      )}

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          {salesPage ? <SalesHero course={summary} page={salesPage} manager={manager} serverNow={serverNow} /> : <CourseHero course={summary} manager={manager} />}
        </div>

        <aside id={ENROLL_ANCHOR} aria-label={t("course.enrollment")} className="min-w-0 scroll-mt-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="lg:sticky lg:top-20">{enrollCard}</div>
        </aside>

        {salesPage ? (
          <div className="min-w-0 space-y-14 lg:col-start-1 lg:row-start-2">
            <SalesSections
              page={salesPage}
              courseTitle={course.title}
              video={previewVideo}
              pricing={{ course, includes: salesIncludes, actionLabel: salesAction }}
              slots={{
                curriculum: curriculumBody,
                instructor: <CourseInstructors instructors={summary.instructors} stats={instructorStats} teachingProfiles={isCoursePublic(course)} />,
              }}
              serverNow={serverNow}
            />
            <CourseRequirements requirements={course.requirements} />
            {!salesPage.sections.some((s) => s.type === "text") && <CourseDescription description={course.description} />}
            {syllabusForm}
            {certificationBlock}
            <CourseAnnouncements announcements={announcements} />
            {reviewsBlock}
          </div>
        ) : (
          <div className="min-w-0 space-y-12 lg:col-start-1 lg:row-start-2">
            <CourseOutcomes outcomes={course.outcomes} />

            <section aria-labelledby="curriculum-heading" id="curriculum" className="scroll-mt-20">
              <SectionHeading
                id="curriculum-heading"
                aside={
                  lessonCount > 0 ? (
                    <span>
                      {summary.totalDurationSeconds > 0
                        ? t("course.contentStatsWithLength", { sections: chapters.length, lessons: lessonCount, duration: f.duration(summary.totalDurationSeconds) })
                        : t("course.contentStats", { sections: chapters.length, lessons: lessonCount })}
                    </span>
                  ) : undefined
                }
              >
                {t("course.content")}
              </SectionHeading>
              {curriculumBody}
            </section>

            {syllabusForm}
            <CourseRequirements requirements={course.requirements} />
            <CourseDescription description={course.description} />
            {certificationBlock}
            <CourseAnnouncements announcements={announcements} />
            <CourseInstructors instructors={summary.instructors} stats={instructorStats} teachingProfiles={isCoursePublic(course)} />
            {reviewsBlock}
          </div>
        )}
      </div>

      <div className="mt-16 space-y-16">
        <RelatedCourses courses={related.courses} explicit={related.explicit} />
        {isCoursePublic(course) && <CourseArticles course={course} />}
      </div>
    </div>
  );
}

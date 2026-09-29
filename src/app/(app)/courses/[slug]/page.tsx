import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ChapterWithLessons, Course, CourseSummary, PublicUser, Review, Settings, User } from "@/lib/types";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
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
import { lessonKindFromBlocks, outlineStats, reviewDateLabel } from "@/components/catalog/format";
import { isPaidCourse } from "@/components/catalog/price-tag";
import type { OutlineChapterView, OutlineMode, ReviewView } from "@/components/catalog/types";
import { siteConfig } from "@/lib/config";
import { formatDuration, stripMarkdown, sum, truncate } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Absolute URL for a possibly relative asset path (e.g. `/uploads/x.jpg`), for OG tags and JSON-LD. */
function absoluteUrl(url: string): string {
  try {
    return new URL(url, `${siteConfig.appUrl}/`).href;
  } catch {
    return url;
  }
}

/** Course meta description (set in the course Settings tab), falling back to the introduction. */
function metaDescription(course: Course): string {
  const custom = course.metaDescription?.trim();
  if (custom) return custom;
  return course.shortIntroduction || truncate(stripMarkdown(course.description).replace(/\s+/g, " "), 160);
}

/** Course meta keywords (comma-separated), falling back to the course tags. */
function metaKeywords(course: Course): string[] {
  const list = (course.metaKeywords ?? "").split(/[,\n]/);
  const keywords = Array.from(new Set(list.map((k) => k.trim()).filter(Boolean)));
  return keywords.length ? keywords : course.tags;
}

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

type ReviewWithUser = Review & { user: PublicUser | null };

function toReviewViews(reviews: ReviewWithUser[], viewerId: string | null): ReviewView[] {
  const now = Date.now();
  return reviews
    .filter((r): r is Review & { user: PublicUser } => !!r.user)
    .map((r) => ({
      id: r.id,
      rating: r.rating,
      review: r.review,
      createdAt: r.createdAt,
      dateLabel: reviewDateLabel(r.createdAt, now),
      author: { id: r.user.id, name: r.user.name, username: r.user.username, avatarUrl: r.user.avatarUrl },
      isOwn: !!viewerId && r.userId === viewerId,
    }));
}

function reviewHint(opts: { user: User | null; enrolled: boolean; instructor: boolean; hasOwn: boolean; upcoming: boolean }): string | null {
  if (opts.instructor || opts.hasOwn) return null;
  if (!opts.user) return "Log in and enroll to rate this course.";
  if (!opts.enrolled) return opts.upcoming ? "Reviews open once the course launches and you enroll." : "Enroll in this course to leave a review.";
  return null;
}

function courseJsonLd(course: CourseSummary, settings: Settings): string {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: course.title,
    description: metaDescription(course),
    provider: { "@type": "Organization", name: settings.brand.name },
    inLanguage: "en",
    keywords: metaKeywords(course).join(", ") || undefined,
    url: absoluteUrl(`/courses/${course.slug}`),
    image: course.imageUrl ? absoluteUrl(course.imageUrl) : undefined,
    instructor: course.instructors.map((i) => ({ "@type": "Person", name: i.name })),
    offers: {
      "@type": "Offer",
      category: isPaidCourse(course) ? "Paid" : "Free",
      price: isPaidCourse(course) ? (course.price / 100).toFixed(2) : "0",
      priceCurrency: course.currency,
    },
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "Online",
      courseWorkload: course.totalDurationSeconds > 0 ? `PT${Math.max(1, Math.round(course.totalDurationSeconds / 60))}M` : undefined,
    },
  };
  if (course.averageRating && course.reviewCount > 0) {
    data.aggregateRating = { "@type": "AggregateRating", ratingValue: course.averageRating, ratingCount: course.reviewCount, bestRating: 5, worstRating: 1 };
  }
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/* ------------------------------------------------------------------ */
/* Metadata                                                            */
/* ------------------------------------------------------------------ */

export async function generateMetadata(props: PageProps<"/courses/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [course, user] = await Promise.all([getCourseBySlug(slug), getCurrentUser()]);
  const enrolled = course && user && !course.published ? !!(await getEnrollment(user.id, course.id)) : false;
  if (!course || !(canViewCourse(user, course) || enrolled)) return { title: "Course not found", robots: { index: false, follow: false } };
  const description = metaDescription(course);
  const keywords = metaKeywords(course);
  const image = course.imageUrl ? absoluteUrl(course.imageUrl) : undefined;
  return {
    metadataBase: new URL(`${siteConfig.appUrl}/`),
    alternates: { canonical: `/courses/${course.slug}` },
    title: course.title,
    description,
    keywords: keywords.length ? keywords : undefined,
    openGraph: {
      type: "website",
      title: course.title,
      description,
      url: `/courses/${course.slug}`,
      images: image ? [{ url: image, alt: course.title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: course.title,
      description,
      images: image ? [image] : undefined,
    },
    robots: course.published ? undefined : { index: false, follow: false },
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function CoursePage(props: PageProps<"/courses/[slug]">) {
  const { slug } = await props.params;
  const [user, settings, course] = await Promise.all([getCurrentUser(), getSettings(), getCourseBySlug(slug)]);
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

  const reviewViews = toReviewViews(reviews, user?.id ?? null);
  const hasOwnReview = reviewViews.some((r) => r.isOwn);
  const isInstructor = !!user && course.instructorIds.includes(user.id);
  const canWriteReview = settings.features.reviews && !!user && !!enrollment && !hasOwnReview && !isInstructor;
  const certificationsEnabled = settings.features.certifications;

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
    />
  );

  const showCertification = certificationsEnabled && (course.enableCertification || course.paidCertificate || !!certificate);

  return (
    <div className="animate-fade-in pb-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: courseJsonLd(summary, settings) }} />

      {!course.published && manager && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
          <Icon.EyeOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-medium">This course is not published.</span>{" "}
            <span className="text-ink-muted">Only its instructors and moderators can see this page. Publish it from the course editor when it&apos;s ready.</span>
          </p>
        </div>
      )}

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <CourseHero course={summary} manager={manager} />
        </div>

        <aside aria-label="Enrollment" className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="lg:sticky lg:top-20">{enrollCard}</div>
        </aside>

        <div className="min-w-0 space-y-12 lg:col-start-1 lg:row-start-2">
          <CourseOutcomes outcomes={course.outcomes} />

          <section aria-labelledby="curriculum-heading" id="curriculum" className="scroll-mt-20">
            <SectionHeading
              id="curriculum-heading"
              aside={
                lessonCount > 0 ? (
                  <span>
                    {outlineStats(chapters.length, lessonCount)}
                    {summary.totalDurationSeconds > 0 && ` · ${formatDuration(summary.totalDurationSeconds)} total length`}
                  </span>
                ) : undefined
              }
            >
              Course content
            </SectionHeading>
            {chapters.length && lessonCount ? (
              <CourseOutline chapters={chapters} mode={mode} defaultOpenIds={defaultOpenIds} nextLessonId={enrollment ? (nextLesson?.id ?? null) : null} />
            ) : (
              <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-10 text-center">
                <Icon.BookOpen className="size-7 text-ink-faint" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-ink-muted">Course content coming soon!</p>
              </div>
            )}
            {mode === "guest" && content.previewLessonCount > 0 && (
              <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
                <Icon.Eye className="size-4 text-accent" aria-hidden="true" />
                Lessons marked <span className="font-medium text-ink">Preview</span> are free to watch without an account.
              </p>
            )}
          </section>

          <CourseRequirements requirements={course.requirements} />
          <CourseDescription description={course.description} />

          {(showCertification || batches.length > 0) && (
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
          )}

          <CourseAnnouncements announcements={announcements} />
          <CourseInstructors instructors={summary.instructors} stats={instructorStats} />

          {settings.features.reviews && (
            <section id="reviews" aria-label="Reviews" className="scroll-mt-20">
              <ReviewsPanel
                courseSlug={course.slug}
                courseTitle={course.title}
                summary={breakdown}
                reviews={reviewViews}
                canWrite={canWriteReview}
                writeHint={reviewHint({ user, enrolled: !!enrollment, instructor: isInstructor, hasOwn: hasOwnReview, upcoming: course.upcoming })}
                canModerate={isModerator(user)}
              />
            </section>
          )}
        </div>
      </div>

      <div className="mt-16">
        <RelatedCourses courses={related.courses} explicit={related.explicit} />
      </div>
    </div>
  );
}

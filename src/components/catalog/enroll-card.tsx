import type { ReactNode } from "react";
import type { Course } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getDripOverview, getPrerequisiteStatus, type DripOverview, type PrerequisiteStatus } from "@/lib/services/drip";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { cn, formatDuration, formatPrice } from "@/lib/utils";
import { UnlockLabel } from "@/components/learn/unlock-time";
import { ClaimCertificateButton, EnrollButton, LeaveCourseButton } from "./enroll-actions";
import { enrolledTier, plural } from "./format";
import { isPaidCourse, PriceTag } from "./price-tag";
import { PrerequisiteList } from "./prerequisite-list";

export interface EnrollCardEnrollment {
  progress: number;
  completedLessons: number;
  totalLessons: number;
  completed: boolean;
  canLeave: boolean;
  purchasedCertificate: boolean;
  viaBatch: boolean;
}

export interface CourseIncludes {
  enrolledCount: number;
  lessonCount: number;
  totalDurationSeconds: number;
  videoSeconds: number;
  hasVideo: boolean;
  quizCount: number;
  assignmentCount: number;
  exerciseCount: number;
  previewCount: number;
}

export interface EnrollCardProps {
  course: Pick<
    Course,
    | "id"
    | "slug"
    | "title"
    | "paidCourse"
    | "price"
    | "currency"
    | "upcoming"
    | "published"
    | "disableSelfLearning"
    | "enableCertification"
    | "paidCertificate"
    | "certificatePrice"
  >;
  manager: boolean;
  enrollment: EnrollCardEnrollment | null;
  nextLesson: { href: string; title: string } | null;
  firstLessonHref: string | null;
  certificate: { code: string } | null;
  /** A paid payment exists for this course but the enrollment is missing. */
  alreadyPaid: boolean;
  batches: { slug: string; title: string; startDate: string }[];
  includes: CourseIncludes;
  certificationsEnabled: boolean;
  className?: string;
}

function IncludeRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-sm text-ink-muted">
      <span className="text-ink-faint [&>svg]:size-4">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function CertificateLinks({ props }: { props: EnrollCardProps }) {
  const { course, enrollment, certificate, certificationsEnabled, manager } = props;
  if (!enrollment || !certificationsEnabled || manager) return null;
  if (certificate) {
    return (
      <ButtonLink href={`/certificates/${certificate.code}`} variant="outline" className="w-full" leftIcon={<Icon.GraduationCap className="size-4" />}>
        View Certificate
      </ButtonLink>
    );
  }
  if (course.paidCertificate) {
    if (enrollment.purchasedCertificate) {
      return (
        <ButtonLink href={`/courses/${course.slug}/certification`} variant="outline" className="w-full" leftIcon={<Icon.GraduationCap className="size-4" />}>
          Get Certified
        </ButtonLink>
      );
    }
    return (
      <ButtonLink href={`/billing/certificate/${course.id}`} variant="outline" className="w-full" leftIcon={<Icon.GraduationCap className="size-4" />}>
        Get Certified · {formatPrice(course.certificatePrice, course.currency)}
      </ButtonLink>
    );
  }
  if (course.enableCertification) {
    if (enrollment.completed) return <ClaimCertificateButton slug={course.slug} />;
    return (
      <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
        <Icon.Award className="mt-px size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        Finish every lesson to earn your certificate of completion.
      </p>
    );
  }
  return null;
}

/** Viewer-specific state the card resolves itself (prerequisites, scheduled content). */
interface CardExtras {
  loggedIn: boolean;
  prerequisites: PrerequisiteStatus;
  drip: DripOverview | null;
}

/** "Next scheduled lesson" line for enrolled learners. */
function NextUnlockNote({ drip }: { drip: DripOverview | null }) {
  const next = drip?.nextUnlock;
  if (!next) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg bg-accent/8 px-3 py-2 text-xs text-ink-muted">
      <Icon.Clock className="mt-px size-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink" title={next.title}>
          Next scheduled: {next.title}
        </span>
        <UnlockLabel at={next.unlocksAt} className="text-accent" />
        {drip.scheduledCount > 1 && <span> · {drip.scheduledCount - 1} more scheduled</span>}
      </span>
    </p>
  );
}

function PrerequisitesBlock({ status, loggedIn, manager }: { status: PrerequisiteStatus; loggedIn: boolean; manager: boolean }) {
  if (!status.items.length) return null;
  const allDone = loggedIn && !status.missing.length;
  const description = manager
    ? "Learners must complete these courses before they can enroll."
    : !loggedIn
      ? "Complete these courses before enrolling. Log in to see your progress."
      : allDone
        ? "You've completed every prerequisite."
        : status.blocking
          ? `Complete ${status.missing.length === 1 ? "this course" : `these ${status.missing.length} courses`} to unlock enrollment.`
          : "Recommended before you start.";
  return (
    <section aria-labelledby="prerequisites-heading" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="prerequisites-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon.ListChecks className="size-4 text-ink-faint" aria-hidden="true" />
          Prerequisites
        </h2>
        {loggedIn && !manager && (
          <Badge tone={allDone ? "success" : "warning"} size="xs">
            {status.items.length - status.missing.length}/{status.items.length} done
          </Badge>
        )}
      </div>
      <p className="text-xs text-ink-muted">{description}</p>
      <PrerequisiteList items={status.items} compact />
    </section>
  );
}

function PrimaryCta({ props, extras }: { props: EnrollCardProps; extras: CardExtras }) {
  const { course, manager, enrollment, nextLesson, firstLessonHref, alreadyPaid, batches } = props;

  if (manager) {
    return (
      <div className="space-y-2">
        <ButtonLink href={`/admin/courses/${course.id}`} size="lg" className="w-full" leftIcon={<Icon.Edit className="size-4" />}>
          Edit course
        </ButtonLink>
        {firstLessonHref && (
          <ButtonLink href={enrollment && nextLesson ? nextLesson.href : firstLessonHref} variant="outline" className="w-full" leftIcon={<Icon.Eye className="size-4" />}>
            {enrollment ? "Continue learning" : "View lessons"}
          </ButtonLink>
        )}
        <p className="text-center text-xs text-ink-muted">You can manage this course, so every lesson is unlocked for you.</p>
      </div>
    );
  }

  if (enrollment) {
    const started = enrollment.completedLessons > 0 || enrollment.progress > 0;
    const label = enrollment.completed ? "Review course" : started ? "Continue learning" : "Start learning";
    return (
      <div className="space-y-3">
        <div>
          <ProgressBar value={enrollment.progress} size="sm" tone={enrollment.completed ? "success" : "accent"} label="Your progress" showLabel />
          <p className="mt-1.5 text-xs text-ink-muted">
            {enrollment.completedLessons} of {enrollment.totalLessons} {plural(enrollment.totalLessons, "lesson")} completed
          </p>
        </div>
        {nextLesson ? (
          <div>
            <ButtonLink href={nextLesson.href} size="lg" className="w-full" leftIcon={<Icon.Play className="size-4" />}>
              {label}
            </ButtonLink>
            {!enrollment.completed && (
              <p className="mt-1.5 truncate text-center text-xs text-ink-muted" title={nextLesson.title}>
                Up next: {nextLesson.title}
              </p>
            )}
          </div>
        ) : extras.drip?.nextUnlock ? (
          <div>
            <Button size="lg" className="w-full" disabled leftIcon={<Icon.Clock className="size-4" />}>
              Next lesson is scheduled
            </Button>
            <p className="mt-1.5 text-center text-xs text-ink-muted">
              <span className="font-medium text-ink">{extras.drip.nextUnlock.title}</span> · <UnlockLabel at={extras.drip.nextUnlock.unlocksAt} />
            </p>
          </div>
        ) : (
          <Button size="lg" className="w-full" disabled>
            Lessons coming soon
          </Button>
        )}
        {nextLesson && !enrollment.completed && <NextUnlockNote drip={extras.drip} />}
      </div>
    );
  }

  if (course.upcoming) {
    return (
      <div className="space-y-2">
        <Button size="lg" className="w-full" disabled leftIcon={<Icon.Clock className="size-4" />}>
          Coming soon
        </Button>
        <p className="text-center text-xs text-ink-muted">Enrollment opens when this course launches.</p>
      </div>
    );
  }

  if (course.disableSelfLearning) {
    const single = batches.length === 1 ? batches[0] : null;
    return (
      <div className="space-y-2">
        <ButtonLink href={single ? `/batches/${single.slug}` : "/batches"} size="lg" className="w-full" leftIcon={<Icon.Users className="size-4" />}>
          Available through a batch
        </ButtonLink>
        <p className="rounded-lg bg-info/10 px-3 py-2 text-center text-xs font-medium text-info">Contact the Administrator to enroll for this course</p>
      </div>
    );
  }

  if (extras.prerequisites.blocking && !alreadyPaid) {
    return (
      <div className="space-y-2">
        <Button size="lg" className="w-full" disabled leftIcon={<Icon.Lock className="size-4" />}>
          {isPaidCourse(course) ? "Complete prerequisites to buy" : "Complete prerequisites to enroll"}
        </Button>
        <p className="text-center text-xs text-ink-muted">
          Finish the {extras.prerequisites.missing.length === 1 ? "course" : "courses"} listed below first. Enrollment unlocks automatically.
        </p>
      </div>
    );
  }

  if (isPaidCourse(course)) {
    if (alreadyPaid) return <EnrollButton slug={course.slug} label="Start course" icon={<Icon.Play className="size-4" />} />;
    return (
      <ButtonLink href={`/billing/course/${course.id}`} size="lg" className="w-full" leftIcon={<Icon.CreditCard className="size-4" />}>
        Buy this course
      </ButtonLink>
    );
  }

  return <EnrollButton slug={course.slug} />;
}

/**
 * Sticky call-to-action card on the course page: price, the primary action
 * for the viewer's state (enroll / buy / continue / coming soon / batch only
 * / prerequisites pending / edit), prerequisite courses with the viewer's
 * status, the next scheduled (drip) lesson, certificate links and the
 * "This course includes" list.
 *
 * A Server Component: it resolves the viewer's prerequisite and drip status
 * itself so every page rendering the card gets them.
 */
export async function EnrollCard(props: EnrollCardProps) {
  const { course, enrollment, includes, manager, certificationsEnabled, className } = props;
  const showPrice = !enrollment && !manager;
  const certificate = certificationsEnabled && (course.enableCertification || course.paidCertificate);

  const [viewer, db] = await Promise.all([getCurrentUser(), getDb()]);
  const fullCourse = db.courses.find((c) => c.id === course.id) ?? null;
  const [prerequisites, drip] = await Promise.all([
    fullCourse ? getPrerequisiteStatus(fullCourse, viewer) : Promise.resolve<PrerequisiteStatus>({ items: [], missing: [], blocking: false }),
    fullCourse && enrollment && !manager ? getDripOverview(fullCourse, viewer) : Promise.resolve(null),
  ]);
  const extras: CardExtras = { loggedIn: !!viewer, prerequisites, drip };
  const showPrerequisites = prerequisites.items.length > 0 && (!enrollment || manager);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="space-y-4 p-5">
        {showPrice && (
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{course.upcoming ? "Launching soon" : "Price"}</p>
              <PriceTag course={course} size="xl" className="mt-0.5 block" />
            </div>
            {course.paidCertificate && certificationsEnabled && course.certificatePrice > 0 && (
              <Badge tone="neutral" size="sm">
                Certificate {formatPrice(course.certificatePrice, course.currency)}
              </Badge>
            )}
          </div>
        )}
        {enrollment && !manager && (
          <div className="flex items-center gap-2">
            <Badge tone={enrollment.completed ? "success" : "accent"} dot>
              {enrollment.completed ? "Completed" : "Enrolled"}
            </Badge>
            {enrollment.viaBatch && <span className="text-xs text-ink-muted">via a batch</span>}
          </div>
        )}

        <PrimaryCta props={props} extras={extras} />
        {showPrerequisites && (
          <div className="border-t border-border pt-4">
            <PrerequisitesBlock status={prerequisites} loggedIn={extras.loggedIn} manager={manager} />
          </div>
        )}
        <CertificateLinks props={props} />

        {enrollment?.canLeave && !manager && (
          <div className="flex justify-center">
            <LeaveCourseButton slug={course.slug} courseTitle={course.title} />
          </div>
        )}
      </div>

      <div className="border-t border-border bg-surface-2/40 p-5">
        <p className="text-sm font-semibold text-ink">This course includes:</p>
        <ul className="mt-3 space-y-2.5">
          {includes.enrolledCount > 0 && <IncludeRow icon={<Icon.Users />}>{enrolledTier(includes.enrolledCount)} enrolled</IncludeRow>}
          {includes.hasVideo && (
            <IncludeRow icon={<Icon.Monitor />}>
              {includes.videoSeconds > 0 ? `${formatDuration(includes.videoSeconds)} of on-demand video` : "On demand course video"}
            </IncludeRow>
          )}
          {includes.lessonCount > 0 && (
            <IncludeRow icon={<Icon.BookOpen />}>
              {includes.lessonCount} {plural(includes.lessonCount, "Lesson")}
              {includes.totalDurationSeconds > 0 && ` · ${formatDuration(includes.totalDurationSeconds)} total`}
            </IncludeRow>
          )}
          {includes.quizCount > 0 && (
            <IncludeRow icon={<Icon.Question />}>
              {includes.quizCount} {plural(includes.quizCount, "Quiz topic", "Quiz topics")}
            </IncludeRow>
          )}
          {includes.assignmentCount > 0 && (
            <IncludeRow icon={<Icon.ClipboardList />}>
              {includes.assignmentCount} {plural(includes.assignmentCount, "Assignment")}
            </IncludeRow>
          )}
          {includes.exerciseCount > 0 && (
            <IncludeRow icon={<Icon.Code />}>
              {includes.exerciseCount} {plural(includes.exerciseCount, "Coding exercise")}
            </IncludeRow>
          )}
          {includes.previewCount > 0 && !enrollment && !manager && (
            <IncludeRow icon={<Icon.Eye />}>
              {includes.previewCount} free preview {plural(includes.previewCount, "lesson")}
            </IncludeRow>
          )}
          {certificate && (
            <IncludeRow icon={<Icon.Award />}>{course.paidCertificate ? "Certificate after an evaluation" : "Certificate of completion"}</IncludeRow>
          )}
          {includes.lessonCount === 0 && <IncludeRow icon={<Icon.Clock />}>Lessons are being prepared</IncludeRow>}
        </ul>
      </div>
    </Card>
  );
}

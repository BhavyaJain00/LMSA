import Link from "next/link";
import type { ReactNode } from "react";
import type { Course, Settings } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getDripOverview, getPrerequisiteStatus, type DripOverview, type PrerequisiteStatus } from "@/lib/services/drip";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { cn, formatPrice } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";
import { UnlockLabel } from "@/components/learn/unlock-time";
import { resolveCourseAccess } from "@/lib/commerce/access";
import { getBillingItem, itemCurrencies, priceItemIn } from "@/lib/data/commerce";
import { requestCountry, viewerCurrency } from "@/lib/commerce/buyer";
import { preferredCurrency } from "@/lib/commerce/currency";
import { cheapestPlanFor } from "@/lib/commerce/membership-views";
import { intervalSuffix } from "@/lib/commerce/plans";
import { MembershipCourseButton } from "@/components/commerce/membership-course-button";
import { bestBundleFor, type CourseBundleOffer } from "@/lib/commerce/bundle-views";
import { installmentOffer, offeredInstallmentPlan } from "@/lib/commerce/installments";
import { toPlanView, type InstallmentPlanView } from "@/lib/commerce/installment-views";
import { InstallmentNotice, orderPath } from "@/components/commerce/installment-plan-card";
import { GiveGiftLink } from "@/components/commerce/give-gift-link";
import { ClaimCertificateButton, EnrollButton, LeaveCourseButton } from "./enroll-actions";
import { enrolledTier } from "./format";
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
  /** The AI tutor's full page for this course, when the viewer may use it. */
  askAiHref?: string | null;
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

async function CertificateLinks({ props }: { props: EnrollCardProps }) {
  const { course, enrollment, certificate, certificationsEnabled, manager } = props;
  if (!enrollment || !certificationsEnabled || manager) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  if (certificate) {
    return (
      <ButtonLink href={`/certificates/${certificate.code}`} variant="outline" className="w-full" leftIcon={<Icon.GraduationCap className="size-4" />}>
        {t("enroll.viewCertificate")}
      </ButtonLink>
    );
  }
  if (course.paidCertificate) {
    if (enrollment.purchasedCertificate) {
      return (
        <ButtonLink href={`/courses/${course.slug}/certification`} variant="outline" className="w-full" leftIcon={<Icon.GraduationCap className="size-4" />}>
          {t("enroll.getCertified")}
        </ButtonLink>
      );
    }
    return (
      <ButtonLink href={`/billing/certificate/${course.id}`} variant="outline" className="w-full" leftIcon={<Icon.GraduationCap className="size-4" />}>
        {t("enroll.getCertifiedFor", { price: f.price(course.certificatePrice, course.currency) })}
      </ButtonLink>
    );
  }
  if (course.enableCertification) {
    if (enrollment.completed) return <ClaimCertificateButton slug={course.slug} />;
    return (
      <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
        <Icon.Award className="mt-px size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        {t("enroll.finishForCertificate")}
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
  /** The viewer's running membership includes this course (they can start it without a checkout). */
  memberPlanName: string | null;
  /** The viewer opened this course through a membership that has ended: lessons are locked, progress is kept. */
  membershipLapsed: boolean;
  /** Cheapest membership plan on sale that includes this course. */
  planOffer: { name: string; priceLabel: string } | null;
  /** "or N payments of X": the course can be paid in installments. */
  installmentOffer: { count: number; partLabel: string } | null;
  /** The payment plan the viewer's access depends on (the course is being paid in installments). */
  paymentPlan: InstallmentPlanView | null;
  /** That plan is paused or was cancelled: lessons are locked, progress is kept. */
  planLocked: boolean;
  /** A bundle on sale that includes this course. */
  bundleOffer: CourseBundleOffer | null;
}

/** "or 3 payments of $17.00" under the buy button of a course sold in installments. */
async function InstallmentOfferLine({ courseId, offer }: { courseId: string; offer: CardExtras["installmentOffer"] }) {
  if (!offer) return null;
  const t = await getT("public");
  return (
    <p className="text-center text-xs text-ink-muted">
      {t.rich("enroll.installmentOffer", {
        count: offer.count,
        amount: offer.partLabel,
        link: (chunks) => (
          <Link href={`/billing/course/${courseId}?pay=installments`} className="font-medium text-accent hover:underline">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}

/** "Also in a bundle" line under the buy button of a paid course. */
async function BundleOfferLine({ offer }: { offer: CardExtras["bundleOffer"] }) {
  if (!offer) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const vars = {
    count: offer.courseCount,
    price: f.price(offer.price, offer.currency),
    savings: offer.savingsPercent,
    link: () => (
      <Link href={`/bundles/${offer.slug}`} className="font-medium text-accent hover:underline">
        {offer.title}
      </Link>
    ),
  };
  return (
    <p className="text-center text-xs text-ink-muted">
      {offer.savingsPercent > 0 ? t.rich("enroll.bundleOfferSave", vars) : t.rich("enroll.bundleOffer", vars)}
    </p>
  );
}

/** "Or join a membership" line under the buy button of a paid course. */
async function MembershipOffer({ offer }: { offer: CardExtras["planOffer"] }) {
  if (!offer) return null;
  const t = await getT("public");
  return (
    <p className="text-center text-xs text-ink-muted">
      {t.rich("enroll.membershipOffer", {
        plan: offer.name,
        link: () => (
          <Link href="/pricing" className="font-medium text-accent hover:underline">
            {offer.priceLabel}
          </Link>
        ),
      })}
    </p>
  );
}

/** "Next scheduled lesson" line for enrolled learners. */
async function NextUnlockNote({ drip }: { drip: DripOverview | null }) {
  const next = drip?.nextUnlock;
  if (!next) return null;
  const t = await getT("public");
  return (
    <p className="flex items-start gap-2 rounded-lg bg-accent/8 px-3 py-2 text-xs text-ink-muted">
      <Icon.Clock className="mt-px size-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink" title={next.title}>
          {t("enroll.nextScheduled", { title: next.title })}
        </span>
        <UnlockLabel at={next.unlocksAt} className="text-accent" />
        {drip.scheduledCount > 1 && <span> · {t("enroll.moreScheduled", { count: drip.scheduledCount - 1 })}</span>}
      </span>
    </p>
  );
}

async function PrerequisitesBlock({ status, loggedIn, manager }: { status: PrerequisiteStatus; loggedIn: boolean; manager: boolean }) {
  if (!status.items.length) return null;
  const t = await getT("public");
  const allDone = loggedIn && !status.missing.length;
  const description = manager
    ? t("enroll.prerequisites.manager")
    : !loggedIn
      ? t("enroll.prerequisites.guest")
      : allDone
        ? t("enroll.prerequisites.allDone")
        : status.blocking
          ? t("enroll.prerequisites.blocking", { count: status.missing.length })
          : t("enroll.prerequisites.recommended");
  return (
    <section aria-labelledby="prerequisites-heading" className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="prerequisites-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon.ListChecks className="size-4 text-ink-faint" aria-hidden="true" />
          {t("enroll.prerequisites.title")}
        </h2>
        {loggedIn && !manager && (
          <Badge tone={allDone ? "success" : "warning"} size="xs">
            {t("enroll.prerequisites.done", { done: status.items.length - status.missing.length, total: status.items.length })}
          </Badge>
        )}
      </div>
      <p className="text-xs text-ink-muted">{description}</p>
      <PrerequisiteList items={status.items} compact />
    </section>
  );
}

/** Opens the course's AI tutor (full page). */
async function AskAiLink({ href }: { href: string }) {
  const t = await getT("public");
  return (
    <ButtonLink href={href} variant="outline" className="w-full" leftIcon={<Icon.Sparkles className="size-4" />}>
      {t("enroll.askAi")}
    </ButtonLink>
  );
}

async function PrimaryCta({ props, extras }: { props: EnrollCardProps; extras: CardExtras }) {
  const { course, manager, enrollment, nextLesson, firstLessonHref, alreadyPaid, batches } = props;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);

  if (manager) {
    return (
      <div className="space-y-2">
        <ButtonLink href={`/admin/courses/${course.id}`} size="lg" className="w-full" leftIcon={<Icon.Edit className="size-4" />}>
          {t("enroll.editCourse")}
        </ButtonLink>
        {firstLessonHref && (
          <ButtonLink href={enrollment && nextLesson ? nextLesson.href : firstLessonHref} variant="outline" className="w-full" leftIcon={<Icon.Eye className="size-4" />}>
            {enrollment ? t("enroll.continueLearning") : t("enroll.viewLessons")}
          </ButtonLink>
        )}
        {props.askAiHref && <AskAiLink href={props.askAiHref} />}
        <p className="text-center text-xs text-ink-muted">{t("enroll.managerNote")}</p>
      </div>
    );
  }

  if (enrollment && extras.membershipLapsed) {
    const canBuy = isPaidCourse(course) && !course.disableSelfLearning;
    return (
      <div className="space-y-3">
        <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-ink">
          <Icon.Lock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{t("enroll.membershipLapsed", { done: enrollment.completedLessons, total: enrollment.totalLessons })}</span>
        </p>
        {extras.planOffer && (
          <ButtonLink href="/pricing" size="lg" className="w-full" leftIcon={<Icon.Star className="size-4" />}>
            {t("enroll.rejoinMembership")}
          </ButtonLink>
        )}
        {canBuy && (
          <ButtonLink
            href={`/billing/course/${course.id}`}
            size={extras.planOffer ? "md" : "lg"}
            variant={extras.planOffer ? "outline" : "primary"}
            className="w-full"
            leftIcon={<Icon.CreditCard className="size-4" />}
          >
            {t("enroll.buyFor", { price: f.price(course.price, course.currency) })}
          </ButtonLink>
        )}
      </div>
    );
  }

  if (enrollment && extras.planLocked && extras.paymentPlan) {
    // A cancelled plan cannot be resumed: the course can be bought again (the progress is kept).
    const canBuy = extras.paymentPlan.status === "cancelled" && isPaidCourse(course) && !course.disableSelfLearning;
    return (
      <div className="space-y-3">
        <InstallmentNotice plan={extras.paymentPlan} compact />
        <p className="text-xs text-ink-muted">{t("enroll.progressSaved", { done: enrollment.completedLessons, total: enrollment.totalLessons })}</p>
        {canBuy && (
          <ButtonLink href={`/billing/course/${course.id}`} size="lg" className="w-full" leftIcon={<Icon.CreditCard className="size-4" />}>
            {t("enroll.buyFor", { price: f.price(course.price, course.currency) })}
          </ButtonLink>
        )}
      </div>
    );
  }

  if (enrollment) {
    const started = enrollment.completedLessons > 0 || enrollment.progress > 0;
    const label = enrollment.completed ? t("enroll.reviewCourse") : started ? t("enroll.continueLearning") : t("enroll.startLearning");
    return (
      <div className="space-y-3">
        <div>
          <ProgressBar value={enrollment.progress} size="sm" tone={enrollment.completed ? "success" : "accent"} label={t("enroll.yourProgress")} showLabel />
          <p className="mt-1.5 text-xs text-ink-muted">{t("enroll.lessonsCompleted", { done: enrollment.completedLessons, total: enrollment.totalLessons })}</p>
        </div>
        {nextLesson ? (
          <div>
            <ButtonLink href={nextLesson.href} size="lg" className="w-full" leftIcon={<Icon.Play className="size-4" />}>
              {label}
            </ButtonLink>
            {!enrollment.completed && (
              <p className="mt-1.5 truncate text-center text-xs text-ink-muted" title={nextLesson.title}>
                {t("enroll.upNext", { title: nextLesson.title })}
              </p>
            )}
          </div>
        ) : extras.drip?.nextUnlock ? (
          <div>
            <Button size="lg" className="w-full" disabled leftIcon={<Icon.Clock className="size-4" />}>
              {t("enroll.nextLessonScheduled")}
            </Button>
            <p className="mt-1.5 text-center text-xs text-ink-muted">
              <span className="font-medium text-ink">{extras.drip.nextUnlock.title}</span> · <UnlockLabel at={extras.drip.nextUnlock.unlocksAt} />
            </p>
          </div>
        ) : (
          <Button size="lg" className="w-full" disabled>
            {t("enroll.lessonsComingSoon")}
          </Button>
        )}
        {nextLesson && !enrollment.completed && <NextUnlockNote drip={extras.drip} />}
        {props.askAiHref && <AskAiLink href={props.askAiHref} />}
        {extras.paymentPlan && <InstallmentNotice plan={extras.paymentPlan} compact />}
        {extras.paymentPlan?.status === "on_track" && extras.paymentPlan.next?.dueAt && (
          <p className="text-center text-xs text-ink-muted">
            {t.rich("enroll.paymentPlan", {
              paid: extras.paymentPlan.paidCount,
              total: extras.paymentPlan.total,
              date: f.date(extras.paymentPlan.next.dueAt),
              link: (chunks) => (
                <Link href={orderPath(extras.paymentPlan!.key)} className="font-medium text-accent hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
      </div>
    );
  }

  if (course.upcoming) {
    return (
      <div className="space-y-2">
        <Button size="lg" className="w-full" disabled leftIcon={<Icon.Clock className="size-4" />}>
          {t("card.comingSoon")}
        </Button>
        <p className="text-center text-xs text-ink-muted">{t("enroll.opensAtLaunch")}</p>
      </div>
    );
  }

  if (course.disableSelfLearning) {
    const single = batches.length === 1 ? batches[0] : null;
    return (
      <div className="space-y-2">
        <ButtonLink href={single ? `/batches/${single.slug}` : "/batches"} size="lg" className="w-full" leftIcon={<Icon.Users className="size-4" />}>
          {t("enroll.viaBatchOnly")}
        </ButtonLink>
        <p className="rounded-lg bg-info/10 px-3 py-2 text-center text-xs font-medium text-info">{t("enroll.askAdmin")}</p>
      </div>
    );
  }

  if (extras.prerequisites.blocking && !alreadyPaid) {
    return (
      <div className="space-y-2">
        <Button size="lg" className="w-full" disabled leftIcon={<Icon.Lock className="size-4" />}>
          {isPaidCourse(course) ? t("enroll.prerequisites.toBuy") : t("enroll.prerequisites.toEnroll")}
        </Button>
        <p className="text-center text-xs text-ink-muted">{t("enroll.prerequisites.finishFirst", { count: extras.prerequisites.missing.length })}</p>
      </div>
    );
  }

  if (isPaidCourse(course)) {
    if (alreadyPaid) return <EnrollButton slug={course.slug} label={t("enroll.startCourse")} icon={<Icon.Play className="size-4" />} />;
    if (extras.memberPlanName) return <MembershipCourseButton slug={course.slug} planName={extras.memberPlanName} />;
    return (
      <div className="space-y-2">
        <ButtonLink href={`/billing/course/${course.id}`} size="lg" className="w-full" leftIcon={<Icon.CreditCard className="size-4" />}>
          {t("enroll.buy")}
        </ButtonLink>
        <InstallmentOfferLine courseId={course.id} offer={extras.installmentOffer} />
        <MembershipOffer offer={extras.planOffer} />
        <BundleOfferLine offer={extras.bundleOffer} />
      </div>
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
export async function EnrollCard(listedProps: EnrollCardProps) {
  const { enrollment, includes, manager, certificationsEnabled, className } = listedProps;
  const listedCourse = listedProps.course;
  const showPrice = !enrollment && !manager;
  const certificate = certificationsEnabled && (listedCourse.enableCertification || listedCourse.paidCertificate);

  const [viewer, db, t, f] = await Promise.all([getCurrentUser(), getDb(), getT("public"), getFormatter()]);
  // Commerce (round 3): the course price in the visitor's currency (as checkout charges it) when the
  // course has a fixed price in it. The certificate keeps its own price and currency.
  const course = showPrice && isPaidCourse(listedCourse) ? await inViewerCurrency(listedCourse, db.settings) : listedCourse;
  const props: EnrollCardProps = course === listedCourse ? listedProps : { ...listedProps, course };
  const fullCourse = db.courses.find((c) => c.id === course.id) ?? null;
  const [prerequisites, drip] = await Promise.all([
    fullCourse ? getPrerequisiteStatus(fullCourse, viewer) : Promise.resolve<PrerequisiteStatus>({ items: [], missing: [], blocking: false }),
    fullCourse && enrollment && !manager ? getDripOverview(fullCourse, viewer) : Promise.resolve(null),
  ]);
  // Commerce (round 3): membership access. A running membership that includes the course replaces
  // the checkout; an enrollment opened through a membership that ended is shown as paused.
  const access = viewer && !manager ? resolveCourseAccess(db, viewer.id, course.id) : null;
  const offerPlan = !manager && isPaidCourse(course) && !access?.membership ? await cheapestPlanFor(course.id) : null;
  // Commerce (round 3): installments and bundles. A course being paid in parts shows its plan (overdue,
  // paused or cancelled plans with the pay action); a course on sale shows "or N payments" and its bundle.
  const buying = !manager && !enrollment && isPaidCourse(course) && !course.upcoming && !course.disableSelfLearning;
  const terms = buying && fullCourse ? offeredInstallmentPlan(fullCourse, { enabled: db.settings.growth.installmentsEnabled, gateway: db.settings.commerce.paymentGateway }) : null;
  const split = terms ? installmentOffer(course.price, course.currency || "USD", terms) : null;
  const planLocked = !!enrollment && (access?.blocked === "installment_overdue" || access?.blocked === "installment_cancelled");
  const livePlan = !!enrollment && !!access?.installments && (planLocked || access.via === "installments") ? access.installments : null;
  const extras: CardExtras = {
    installmentOffer: split ? { count: split.count, partLabel: f.price(split.partAmount, course.currency) } : null,
    paymentPlan: livePlan ? toPlanView(livePlan, fullCourse, db.settings.commerce.paymentGateway) : null,
    planLocked,
    bundleOffer: buying ? await bestBundleFor(course.id) : null,
    loggedIn: !!viewer,
    prerequisites,
    drip,
    memberPlanName: access?.membership && !enrollment ? access.membership.plan.name : null,
    membershipLapsed: !!enrollment && access?.blocked === "membership_lapsed",
    planOffer: offerPlan ? { name: offerPlan.name, priceLabel: `${formatPrice(offerPlan.price, offerPlan.currency, undefined, f.locale)}${intervalSuffix(offerPlan.interval)}` } : null,
  };
  const showPrerequisites = prerequisites.items.length > 0 && (!enrollment || manager);
  // Commerce (round 3): gifts. Anyone may buy a paid course on sale for someone else.
  const giftable = !manager && db.settings.growth.giftsEnabled && isPaidCourse(course) && course.published && !course.upcoming && !course.disableSelfLearning;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="space-y-4 p-5">
        {showPrice && (
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{course.upcoming ? t("enroll.launchingSoon") : t("enroll.price")}</p>
              <PriceTag course={course} size="xl" className="mt-0.5 block" />
            </div>
            {course.paidCertificate && certificationsEnabled && course.certificatePrice > 0 && (
              <Badge tone="neutral" size="sm">
                {t("enroll.certificatePrice", { price: f.price(course.certificatePrice, listedCourse.currency) })}
              </Badge>
            )}
          </div>
        )}
        {enrollment && !manager && (
          <div className="flex items-center gap-2">
            <Badge tone={extras.membershipLapsed || extras.planLocked ? "warning" : enrollment.completed ? "success" : "accent"} dot>
              {extras.membershipLapsed || extras.planLocked ? t("enroll.accessPaused") : enrollment.completed ? t("card.completed") : t("enroll.enrolled")}
            </Badge>
            {enrollment.viaBatch && <span className="text-xs text-ink-muted">{t("enroll.viaBatch")}</span>}
          </div>
        )}

        <PrimaryCta props={props} extras={extras} />
        {showPrerequisites && (
          <div className="border-t border-border pt-4">
            <PrerequisitesBlock status={prerequisites} loggedIn={extras.loggedIn} manager={manager} />
          </div>
        )}
        <CertificateLinks props={listedProps} />
        {giftable && (
          <div className="flex justify-center">
            <GiveGiftLink type="course" id={course.id} />
          </div>
        )}

        {enrollment?.canLeave && !manager && (
          <div className="flex justify-center">
            <LeaveCourseButton slug={course.slug} courseTitle={course.title} />
          </div>
        )}
      </div>

      <div className="border-t border-border bg-surface-2/40 p-5">
        <p className="text-sm font-semibold text-ink">{t("enroll.includes.title")}</p>
        <ul className="mt-3 space-y-2.5">
          {includes.enrolledCount > 0 && <IncludeRow icon={<Icon.Users />}>{t("enroll.includes.enrolled", { amount: enrolledTier(includes.enrolledCount) })}</IncludeRow>}
          {includes.hasVideo && (
            <IncludeRow icon={<Icon.Monitor />}>
              {includes.videoSeconds > 0 ? t("enroll.includes.video", { duration: f.duration(includes.videoSeconds) }) : t("enroll.includes.videoPlain")}
            </IncludeRow>
          )}
          {includes.lessonCount > 0 && (
            <IncludeRow icon={<Icon.BookOpen />}>
              {includes.totalDurationSeconds > 0
                ? t("enroll.includes.lessonsTotal", { count: includes.lessonCount, duration: f.duration(includes.totalDurationSeconds) })
                : t("enroll.includes.lessons", { count: includes.lessonCount })}
            </IncludeRow>
          )}
          {includes.quizCount > 0 && <IncludeRow icon={<Icon.Question />}>{t("enroll.includes.quizzes", { count: includes.quizCount })}</IncludeRow>}
          {includes.assignmentCount > 0 && (
            <IncludeRow icon={<Icon.ClipboardList />}>{t("enroll.includes.assignments", { count: includes.assignmentCount })}</IncludeRow>
          )}
          {includes.exerciseCount > 0 && <IncludeRow icon={<Icon.Code />}>{t("enroll.includes.exercises", { count: includes.exerciseCount })}</IncludeRow>}
          {includes.previewCount > 0 && !enrollment && !manager && (
            <IncludeRow icon={<Icon.Eye />}>{t("enroll.includes.previews", { count: includes.previewCount })}</IncludeRow>
          )}
          {certificate && (
            <IncludeRow icon={<Icon.Award />}>{course.paidCertificate ? t("enroll.includes.certificateEvaluation") : t("enroll.includes.certificateCompletion")}</IncludeRow>
          )}
          {includes.lessonCount === 0 && <IncludeRow icon={<Icon.Clock />}>{t("enroll.includes.preparing")}</IncludeRow>}
        </ul>
      </div>
    </Card>
  );
}

/** `course` priced in the viewer's currency (cookie choice, else their country's) when it has a fixed price in it. */
async function inViewerCurrency<C extends EnrollCardProps["course"]>(course: C, settings: Pick<Settings, "growth">): Promise<C> {
  if (!settings.growth.multiCurrency) return course;
  const item = await getBillingItem("course", course.id);
  if (!item) return course;
  const [chosen, country] = await Promise.all([viewerCurrency(), requestCountry()]);
  const priced = priceItemIn(item, preferredCurrency(chosen, country, itemCurrencies(item, settings)), settings);
  if (priced.currency === course.currency && priced.amount === course.price) return course;
  return { ...course, price: priced.amount, currency: priced.currency };
}

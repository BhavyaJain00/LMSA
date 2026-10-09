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
import { coursePriceLabel, isPaidCourse } from "./price-tag";

export interface EnrollCardEnrollment {
  progress: number;
  completedLessons: number;
  totalLessons: number;
  completed: boolean;
  canLeave: boolean;
  purchasedCertificate: boolean;
  viaBatch: boolean;
}

/** What the course contains (shown on the course page's "Course content" line). */
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
  certificationsEnabled: boolean;
  /** The AI tutor's full page for this course, when the viewer may use it. */
  askAiHref?: string | null;
  /** Anchor of the page's prerequisites card (linked from the "complete prerequisites" state). */
  prerequisitesAnchor?: string;
  className?: string;
}

const secondaryLink = "inline-flex items-center gap-1.5 font-medium text-accent hover:underline";

/** One small line under the main button: an icon (accent for links, quiet for information) and its content. */
function SecondaryItem({ icon, children, tone = "accent" }: { icon: ReactNode; children: ReactNode; tone?: "accent" | "muted" }) {
  return (
    <li className="flex items-start gap-1.5 text-sm text-ink-muted">
      <span className={cn("mt-0.5 shrink-0 [&>svg]:size-4", tone === "accent" ? "text-accent" : "text-ink-faint")} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * The certificate line: what the course awards (with a link to the certification page) for visitors and staff,
 * and the learner's next certificate step once enrolled (view, get certified, buy the evaluation, or finish
 * the lessons). Claiming a free certificate is a button and is rendered above the list instead.
 */
async function CertificateItem({ props }: { props: EnrollCardProps }) {
  const { course, enrollment, certificate, certificationsEnabled, manager } = props;
  if (!certificationsEnabled) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const details = (
    <Link href={`/courses/${course.slug}/certification`} className="font-medium text-accent hover:underline">
      {t("enroll.certificateDetails")}
    </Link>
  );
  const withDetails = (main: ReactNode) => (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      {main}
      <span aria-hidden="true">·</span>
      {details}
    </span>
  );

  if (enrollment && !manager) {
    if (certificate) {
      return (
        <SecondaryItem icon={<Icon.GraduationCap />}>
          {withDetails(
            <Link href={`/certificates/${certificate.code}`} className={secondaryLink}>
              {t("enroll.viewCertificate")}
            </Link>,
          )}
        </SecondaryItem>
      );
    }
    if (course.paidCertificate) {
      if (enrollment.purchasedCertificate) {
        return (
          <SecondaryItem icon={<Icon.GraduationCap />}>
            <Link href={`/courses/${course.slug}/certification`} className={secondaryLink}>
              {t("enroll.getCertified")}
            </Link>
          </SecondaryItem>
        );
      }
      return (
        <SecondaryItem icon={<Icon.GraduationCap />}>
          {withDetails(
            <Link href={`/billing/certificate/${course.id}`} className={secondaryLink}>
              {t("enroll.getCertifiedFor", { price: f.price(course.certificatePrice, course.currency) })}
            </Link>,
          )}
        </SecondaryItem>
      );
    }
    if (course.enableCertification) {
      // Completed: the claim button above the list replaces this line.
      if (enrollment.completed) return null;
      return (
        <SecondaryItem icon={<Icon.Award />} tone="muted">
          {withDetails(<span>{t("enroll.finishForCertificate")}</span>)}
        </SecondaryItem>
      );
    }
    return null;
  }

  if (!course.enableCertification && !course.paidCertificate) return null;
  const label = course.paidCertificate
    ? course.certificatePrice > 0
      ? t("enroll.certificateEvaluationPrice", { price: f.price(course.certificatePrice, course.currency) })
      : t("enroll.includes.certificateEvaluation")
    : t("enroll.includes.certificateCompletion");
  return (
    <SecondaryItem icon={<Icon.Award />} tone="muted">
      {withDetails(<span>{label}</span>)}
    </SecondaryItem>
  );
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
    const percent = Math.round(Math.max(0, Math.min(100, enrollment.progress)));
    return (
      <div className="space-y-4">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-3xl font-extrabold tracking-tight tabular-nums text-ink">{t("enroll.progressPercent", { percent })}</p>
            <p className="text-meta text-ink-faint">{t("enroll.lessonsCompleted", { done: enrollment.completedLessons, total: enrollment.totalLessons })}</p>
          </div>
          <ProgressBar value={percent} size="md" tone={enrollment.completed ? "success" : "accent"} label={t("enroll.yourProgress")} className="mt-3" />
        </div>
        {nextLesson ? (
          <div>
            <ButtonLink href={nextLesson.href} size="lg" className="w-full" leftIcon={<Icon.Play className="size-4" />}>
              {label}
            </ButtonLink>
            {!enrollment.completed && (
              <p className="mt-2 truncate text-center text-xs text-ink-muted" title={nextLesson.title}>
                {t("enroll.upNext", { title: nextLesson.title })}
              </p>
            )}
          </div>
        ) : extras.drip?.nextUnlock ? (
          <div>
            <Button size="lg" className="w-full" disabled leftIcon={<Icon.Clock className="size-4" />}>
              {t("enroll.nextLessonScheduled")}
            </Button>
            <p className="mt-2 text-center text-xs text-ink-muted">
              <span className="font-medium text-ink">{extras.drip.nextUnlock.title}</span> · <UnlockLabel at={extras.drip.nextUnlock.unlocksAt} />
            </p>
          </div>
        ) : (
          <Button size="lg" className="w-full" disabled>
            {t("enroll.lessonsComingSoon")}
          </Button>
        )}
        {nextLesson && !enrollment.completed && <NextUnlockNote drip={extras.drip} />}
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
        <p className="text-center text-xs text-ink-muted">
          {t("enroll.prerequisites.finishFirst", { count: extras.prerequisites.missing.length })}
          {props.prerequisitesAnchor && (
            <>
              {" "}
              <a href={`#${props.prerequisitesAnchor}`} className="font-medium text-accent hover:underline">
                {t("enroll.seePrerequisites")}
              </a>
            </>
          )}
        </p>
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
 * The enroll card at the top of the course page: the price in large type (or, for learners, their progress), ONE
 * full-width primary action for the viewer's state (enroll / buy / continue / coming soon / batch only /
 * prerequisites pending / edit), the paid-course offers under it, and a short list of secondary links (the
 * certificate, the AI tutor, giving the course as a gift, leaving the course) where they apply.
 *
 * A Server Component: it resolves the viewer's prerequisite, drip, membership and installment status itself.
 * The prerequisite courses themselves are listed in a card further down the page (`prerequisitesAnchor`).
 */
export async function EnrollCard(listedProps: EnrollCardProps) {
  const { enrollment, manager, className } = listedProps;
  const listedCourse = listedProps.course;
  const showPrice = !enrollment && !manager;

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
  // Commerce (round 3): gifts. Anyone may buy a paid course on sale for someone else.
  const giftable = !manager && db.settings.growth.giftsEnabled && isPaidCourse(course) && course.published && !course.upcoming && !course.disableSelfLearning;
  // The AI tutor link sits with the secondary links for staff and for learners whose access is not paused.
  const accessPaused = extras.membershipLapsed || extras.planLocked;
  const ctaPaused = extras.membershipLapsed || (extras.planLocked && !!extras.paymentPlan);
  const askAiHref = listedProps.askAiHref && (manager || (enrollment && !ctaPaused)) ? listedProps.askAiHref : null;
  const claimCertificate =
    !!enrollment && !manager && listedProps.certificationsEnabled && !listedProps.certificate && !listedCourse.paidCertificate && listedCourse.enableCertification && enrollment.completed;
  const certificateItem = await CertificateItem({ props: listedProps });
  const leave = !!enrollment?.canLeave && !manager;
  const hasSecondary = !!certificateItem || !!askAiHref || giftable || leave;

  return (
    <Card className={cn("p-4 sm:p-6", className)}>
      {showPrice && (
        <div className="mb-5">
          {course.upcoming && <p className="text-meta font-semibold text-ink-faint">{t("enroll.launchingSoon")}</p>}
          <p className="text-4xl font-extrabold tracking-tight tabular-nums text-ink">
            <span className="sr-only">{t("enroll.price")}: </span>
            {coursePriceLabel(course, t("catalog.free"), f.locale)}
          </p>
        </div>
      )}
      {enrollment && !manager && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={accessPaused ? "warning" : enrollment.completed ? "success" : "accent"} dot>
            {accessPaused ? t("enroll.accessPaused") : enrollment.completed ? t("card.completed") : t("enroll.enrolled")}
          </Badge>
          {enrollment.viaBatch && <span className="text-xs text-ink-muted">{t("enroll.viaBatch")}</span>}
        </div>
      )}

      <PrimaryCta props={props} extras={extras} />

      {claimCertificate && (
        <div className="mt-3">
          <ClaimCertificateButton slug={listedCourse.slug} />
        </div>
      )}

      {hasSecondary && (
        <ul className="mt-5 space-y-2.5 border-t border-border pt-4">
          {certificateItem}
          {askAiHref && (
            <SecondaryItem icon={<Icon.Sparkles />}>
              <Link href={askAiHref} className={secondaryLink}>
                {t("enroll.askAi")}
              </Link>
            </SecondaryItem>
          )}
          {giftable && (
            <li>
              <GiveGiftLink type="course" id={course.id} />
            </li>
          )}
          {leave && (
            <li className="pt-1">
              <LeaveCourseButton slug={course.slug} courseTitle={course.title} />
            </li>
          )}
        </ul>
      )}
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

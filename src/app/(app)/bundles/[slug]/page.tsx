import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { CourseSummary } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getBundleDetail, type BundleDetail } from "@/lib/commerce/bundle-views";
import { courseListPrice } from "@/lib/commerce/bundles";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { itemListJsonLd, seoContext } from "@/lib/seo/jsonld";
import { HOME_CRUMB } from "@/lib/seo/breadcrumbs";
import { Markdown } from "@/lib/markdown";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress";
import { CourseCover } from "@/components/catalog/course-cover";
import { plural } from "@/components/catalog/format";
import { coursePriceLabel } from "@/components/catalog/price-tag";
import { RatingInline } from "@/components/catalog/rating-stars";
import { BundleCard, BundleCover, SavingsBadge } from "@/components/commerce/bundle-card";
import { money } from "@/components/commerce/order-summary";
import { formatDuration, formatPrice, stripMarkdown } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/bundles/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [detail, settings] = await Promise.all([getBundleDetail(slug, null), getSettings()]);
  if (!detail) return notFoundMetadata("Bundle not found");
  const { bundle, courses, pricing } = detail;
  const cover = bundle.imageUrl ?? courses.find((c) => c.imageUrl)?.imageUrl;
  return pageMetadata(
    {
      title: bundle.title,
      description: [
        stripMarkdown(bundle.description),
        `${courses.length} ${plural(courses.length, "course")} for ${formatPrice(bundle.price, bundle.currency)}${pricing.savingsPercent > 0 ? `, ${pricing.savingsPercent}% less than buying them separately` : ""}: ${courses.map((c) => c.title).join(", ")}.`,
      ],
      path: `/bundles/${bundle.slug}`,
      image: cover ? { url: cover, alt: bundle.title } : undefined,
    },
    settings,
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-ink-muted">
      <span className="mt-0.5 shrink-0 text-ink-faint [&>svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** The buy box: price against the value of the courses, and the action that fits the viewer. */
function PurchaseCard({ detail, loggedIn, admin }: { detail: BundleDetail; loggedIn: boolean; admin: boolean }) {
  const { bundle, courses, pricing, onSale, ownsAll, ownedIds, paidOrderId, pendingOrderId } = detail;
  const cheaper = pricing.comparable && pricing.savings > 0;
  const first = courses.find((c) => !c.enrollment?.completedAt) ?? courses[0];
  const ownedShown = courses.filter((c) => ownedIds.includes(c.id)).length;

  let action: ReactNode;
  if (paidOrderId) {
    action = (
      <div className="space-y-2">
        <p role="status" className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-ink">
          <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          You bought this bundle. Every course in it is yours for good.
        </p>
        {first && (
          <ButtonLink href={`/courses/${first.slug}`} size="lg" className="w-full" leftIcon={<Icon.Play className="size-4" />}>
            Continue learning
          </ButtonLink>
        )}
        <ButtonLink href={`/billing/success/${encodeURIComponent(paidOrderId)}`} variant="outline" className="w-full" leftIcon={<Icon.Receipt className="size-4" />}>
          View your order
        </ButtonLink>
      </div>
    );
  } else if (ownsAll) {
    action = (
      <div className="space-y-2">
        <p role="status" className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2.5 text-sm text-ink">
          <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          You already have every course in this bundle, so there is nothing to buy.
        </p>
        {first && (
          <ButtonLink href={`/courses/${first.slug}`} size="lg" className="w-full" leftIcon={<Icon.Play className="size-4" />}>
            Continue learning
          </ButtonLink>
        )}
      </div>
    );
  } else if (pendingOrderId) {
    action = (
      <div className="space-y-2">
        <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-ink">
          <Icon.Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          You have an open order for this bundle. The courses unlock as soon as it is paid.
        </p>
        <ButtonLink href={`/billing/success/${encodeURIComponent(pendingOrderId)}`} size="lg" className="w-full" leftIcon={<Icon.CreditCard className="size-4" />}>
          Complete your order
        </ButtonLink>
      </div>
    );
  } else if (!onSale) {
    action = (
      <p role="status" className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink-muted">
        <Icon.EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {!bundle.published
          ? "This bundle is a draft. Only administrators can see this page until it is published."
          : courses.length === 0
            ? "None of this bundle's courses is published yet, so buyers can't see it."
            : "Bundle sales are switched off, so buyers can't see this page."}
      </p>
    );
  } else {
    action = (
      <div className="space-y-2">
        <ButtonLink href={`/billing/bundle/${bundle.id}`} size="lg" className="w-full" leftIcon={<Icon.CreditCard className="size-4" />}>
          Buy this bundle
        </ButtonLink>
        {!loggedIn && <p className="text-center text-xs text-ink-muted">You&apos;ll be asked to log in or create an account first.</p>}
        {ownedShown > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
            <Icon.Info className="mt-px size-4 shrink-0 text-ink-faint" aria-hidden="true" />
            You already have {ownedShown} of the {courses.length} courses. The bundle adds the rest; its price stays the same.
          </p>
        )}
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="space-y-4 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Bundle price</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-3xl font-semibold tracking-tight tabular-nums text-ink">{formatPrice(bundle.price, bundle.currency)}</span>
            {cheaper && (
              <span className="text-base tabular-nums text-ink-muted line-through">
                <span className="sr-only">Bought separately: </span>
                {formatPrice(pricing.totalValue, bundle.currency)}
              </span>
            )}
            <SavingsBadge percent={pricing.savingsPercent} />
          </p>
          {cheaper && (
            <p className="mt-1 text-sm text-success">
              You save {formatPrice(pricing.savings, bundle.currency)} compared with buying the {plural(courses.length, "course")} one by one.
            </p>
          )}
        </div>
        {action}
        {admin && (
          <ButtonLink href={`/admin/settings/plans?tab=bundles&bq=${encodeURIComponent(bundle.slug)}`} variant="ghost" size="sm" className="w-full" leftIcon={<Icon.Edit className="size-4" />}>
            Manage this bundle
          </ButtonLink>
        )}
      </div>
      <div className="border-t border-border bg-surface-2/40 p-5">
        <p className="text-sm font-semibold text-ink">This bundle includes:</p>
        <ul className="mt-3 space-y-2.5">
          <Fact icon={<Icon.Layers />}>
            {courses.length} {plural(courses.length, "course")}, unlocked together
          </Fact>
          {detail.lessonCount > 0 && (
            <Fact icon={<Icon.BookOpen />}>
              {detail.lessonCount} {plural(detail.lessonCount, "lesson")}
              {detail.durationSeconds > 0 && ` · ${formatDuration(detail.durationSeconds)} in total`}
            </Fact>
          )}
          <Fact icon={<Icon.Unlock />}>One payment, no subscription. The courses stay yours.</Fact>
          <Fact icon={<Icon.TrendingUp />}>Learn at your own pace; progress is tracked per course.</Fact>
          {detail.upcomingCount > 0 && (
            <Fact icon={<Icon.Clock />}>
              {detail.upcomingCount} more {plural(detail.upcomingCount, "course")} added to your account at launch, at no extra cost
            </Fact>
          )}
        </ul>
      </div>
    </Card>
  );
}

function CourseRow({ course, owned, position }: { course: CourseSummary; owned: boolean; position: number }) {
  const progress = course.enrollment ? Math.min(100, Math.ceil(course.progress ?? course.enrollment.progress ?? 0)) : null;
  return (
    <li className="relative flex gap-4 rounded-card border border-border bg-surface-1 p-3 shadow-card transition-shadow focus-within:ring-2 focus-within:ring-accent/60 hover:shadow-pop sm:p-4">
      <CourseCover title={course.title} imageUrl={course.imageUrl} gradient={course.cardGradient} className="hidden h-24 w-40 shrink-0 rounded-lg sm:block" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Course {position}</p>
            <h3 className="text-base font-semibold leading-snug text-ink">
              <Link href={`/courses/${course.slug}`} className="outline-none before:absolute before:inset-0 before:content-[''] hover:text-accent">
                {course.title}
              </Link>
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {owned && (
              <Badge tone="accent" size="xs">
                <Icon.CheckCircle className="size-3" aria-hidden="true" />
                You have this
              </Badge>
            )}
            <span className="text-sm font-medium tabular-nums text-ink-muted">
              <span className="sr-only">Price on its own: </span>
              {coursePriceLabel(course)}
            </span>
          </div>
        </div>
        {course.shortIntroduction && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{course.shortIntroduction}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {course.lessonCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon.BookOpen className="size-3.5" aria-hidden="true" />
              {course.lessonCount} {plural(course.lessonCount, "lesson")}
            </span>
          )}
          {course.totalDurationSeconds > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon.Clock className="size-3.5" aria-hidden="true" />
              {formatDuration(course.totalDurationSeconds)}
            </span>
          )}
          <RatingInline average={course.averageRating} count={course.reviewCount} />
          {course.instructors.length > 0 && <span className="truncate">by {course.instructors.map((i) => i.name).join(", ")}</span>}
          {(course.enableCertification || course.paidCertificate) && (
            <span className="inline-flex items-center gap-1">
              <Icon.Award className="size-3.5" aria-hidden="true" />
              Certificate
            </span>
          )}
        </p>
        {progress !== null && progress > 0 && <ProgressBar value={progress} size="xs" label={`${progress}% completed`} className="mt-2 max-w-xs" />}
      </div>
    </li>
  );
}

export default async function BundlePage(props: PageProps<"/bundles/[slug]">) {
  const { slug } = await props.params;
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  const detail = await getBundleDetail(slug, user);
  if (!detail) notFound();
  const { bundle, courses, pricing, others } = detail;
  const admin = isAdmin(user);
  const priced = courses.filter((c) => courseListPrice(c) > 0);

  return (
    <div className="pb-12">
      <Breadcrumbs items={[HOME_CRUMB, { name: "Bundles", path: "/bundles" }, { name: bundle.title }]} />
      <JsonLd
        data={itemListJsonLd(
          bundle.title,
          courses.map((c) => ({ name: c.title, path: `/courses/${c.slug}`, image: c.imageUrl })),
          seoContext(settings),
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-8">
          <header>
            <BundleCover title={bundle.title} imageUrl={bundle.imageUrl} courses={courses} variant="hero" priority="high" className="h-44 rounded-card border border-border sm:h-60" />
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Badge tone="accent">
                <Icon.Gift className="size-3" aria-hidden="true" />
                Bundle
              </Badge>
              <SavingsBadge percent={pricing.savingsPercent} />
              {!bundle.published && (
                <Badge tone="dark">
                  <Icon.EyeOff className="size-3" aria-hidden="true" />
                  Draft
                </Badge>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{bundle.title}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <Icon.Layers className="size-4" aria-hidden="true" />
                {courses.length} {plural(courses.length, "course")}
              </span>
              {detail.lessonCount > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon.BookOpen className="size-4" aria-hidden="true" />
                  {detail.lessonCount} {plural(detail.lessonCount, "lesson")}
                </span>
              )}
              {detail.durationSeconds > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon.Clock className="size-4" aria-hidden="true" />
                  {formatDuration(detail.durationSeconds)}
                </span>
              )}
            </p>
            {bundle.description.trim() && (
              <div className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-muted">
                <Markdown content={bundle.description} />
              </div>
            )}
          </header>

          {/* On small screens the buy box comes before the long course list. */}
          <div className="lg:hidden">
            <PurchaseCard detail={detail} loggedIn={!!user} admin={admin} />
          </div>

          <section aria-labelledby="bundle-courses-heading">
            <h2 id="bundle-courses-heading" className="text-lg font-semibold tracking-tight text-ink">
              Courses in this bundle
            </h2>
            {courses.length === 0 ? (
              <p className="mt-3 rounded-card border border-dashed border-border-strong px-5 py-8 text-center text-sm text-ink-muted">
                The courses of this bundle are not published yet. They appear here as soon as they launch.
              </p>
            ) : (
              <ol className="mt-3 space-y-3">
                {courses.map((course, i) => (
                  <CourseRow key={course.id} course={course} position={i + 1} owned={detail.ownedIds.includes(course.id)} />
                ))}
              </ol>
            )}
            {detail.upcomingCount > 0 && courses.length > 0 && (
              <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
                <Icon.Clock className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                {detail.upcomingCount} more {plural(detail.upcomingCount, "course")} in this bundle {detail.upcomingCount === 1 ? "is" : "are"} still being prepared. Buyers get{" "}
                {detail.upcomingCount === 1 ? "it" : "them"} automatically at launch.
              </p>
            )}
          </section>

          {courses.length > 0 && (
            <section aria-labelledby="bundle-value-heading" className="rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6">
              <h2 id="bundle-value-heading" className="text-lg font-semibold tracking-tight text-ink">
                What you save
              </h2>
              {pricing.comparable ? (
                <dl className="mt-4 text-sm">
                  {courses.map((course) => (
                    <div key={course.id} className="flex items-baseline justify-between gap-4 border-b border-border py-2">
                      <dt className="min-w-0 truncate text-ink-muted">{course.title}</dt>
                      <dd className="shrink-0 tabular-nums text-ink">{coursePriceLabel(course)}</dd>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-4 py-2">
                    <dt className="text-ink-muted">
                      {priced.length === courses.length ? "Bought separately" : `Bought separately (${priced.length} paid ${plural(priced.length, "course")})`}
                    </dt>
                    <dd className="shrink-0 tabular-nums text-ink">{money(pricing.totalValue, bundle.currency)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t border-border-strong py-2">
                    <dt className="font-semibold text-ink">Bundle price</dt>
                    <dd className="shrink-0 text-lg font-bold tabular-nums text-ink">{money(bundle.price, bundle.currency)}</dd>
                  </div>
                  {pricing.savings > 0 && (
                    <div className="flex items-baseline justify-between gap-4 rounded-lg bg-success/10 px-3 py-2">
                      <dt className="font-medium text-success">You save</dt>
                      <dd className="shrink-0 font-semibold tabular-nums text-success">
                        {money(pricing.savings, bundle.currency)} ({pricing.savingsPercent}%)
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">
                  The courses of this bundle are priced in different currencies, so their combined value isn&apos;t shown. The bundle costs{" "}
                  <strong className="text-ink">{money(bundle.price, bundle.currency)}</strong> for all {courses.length} of them.
                </p>
              )}
            </section>
          )}

          <section aria-labelledby="bundle-how-heading">
            <h2 id="bundle-how-heading" className="text-lg font-semibold tracking-tight text-ink">
              How bundles work
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {[
                { icon: <Icon.CreditCard className="size-5" />, title: "Pay once", text: "One checkout for the whole bundle. There is no subscription and nothing renews." },
                { icon: <Icon.Unlock className="size-5" />, title: "Everything unlocks", text: "You are enrolled in every course straight after payment and can start with any of them." },
                { icon: <Icon.Award className="size-5" />, title: "Yours to keep", text: "The courses stay in your account with your progress, quiz results and certificates." },
              ].map((item) => (
                <div key={item.title} className="rounded-card border border-border bg-surface-1 p-5">
                  <span className="inline-flex rounded-lg bg-accent/10 p-2 text-accent" aria-hidden="true">
                    {item.icon}
                  </span>
                  <h3 className="mt-3 text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{item.text}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="hidden lg:sticky lg:top-20 lg:block" aria-label="Buy this bundle">
          <PurchaseCard detail={detail} loggedIn={!!user} admin={admin} />
        </aside>
      </div>

      {others.length > 0 && (
        <section aria-labelledby="more-bundles-heading" className="mt-12">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="more-bundles-heading" className="text-lg font-semibold tracking-tight text-ink">
              More bundles
            </h2>
            <Link href="/bundles" className="text-sm font-medium text-accent hover:underline">
              See all bundles
            </Link>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {others.map((other) => (
              <li key={other.id}>
                <BundleCard bundle={other} headingLevel="h3" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import type { CourseSummary, PublicUser } from "@/lib/types";
import { AvatarGroup } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getT } from "@/i18n/server";
import { CourseCover } from "../course-cover";
import { compactCount } from "../format";
import { PriceTag } from "../price-tag";

/**
 * Guest landing hero: brand tagline, description, primary CTAs and a
 * spotlight card for the top featured course (real data only).
 */
export async function LandingHero({
  brandName,
  tagline,
  description,
  signupEnabled,
  browse,
  spotlight,
  instructors,
  courseCount,
  learnerCount,
  averageRating,
  reviewCount,
}: {
  brandName: string;
  tagline: string;
  description?: string;
  signupEnabled: boolean;
  /** Secondary "browse the catalog" link; null hides it (e.g. guests can't browse and signup is off). */
  browse: { href: string; label: string } | null;
  spotlight: CourseSummary | null;
  instructors: PublicUser[];
  courseCount: number;
  learnerCount: number;
  averageRating: number | null;
  reviewCount: number;
}) {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  return (
    <section aria-labelledby="landing-title" className="relative isolate overflow-hidden rounded-3xl border border-border bg-surface-1 px-5 py-10 shadow-card sm:px-10 sm:py-14 lg:px-14">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 -z-10 size-96 rounded-full bg-accent/15 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-20 -z-10 size-96 rounded-full bg-info/10 blur-3xl" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 text-ink opacity-[0.035]"
        style={{ backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)", backgroundSize: "22px 22px" }}
      />

      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            <Icon.Sparkles className="size-3.5" aria-hidden="true" />
            {t("home.hero.welcome", { brand: brandName })}
          </p>
          <h1 id="landing-title" className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-6xl">
            {tagline}
          </h1>
          {description && <p className="mt-5 max-w-xl text-base leading-7 text-ink-muted sm:text-lg">{description}</p>}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {signupEnabled ? (
              <ButtonLink href="/register" size="lg" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                {t("home.hero.getStarted")}
              </ButtonLink>
            ) : (
              <ButtonLink href="/login" size="lg" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
                {t("home.hero.logInToStart")}
              </ButtonLink>
            )}
            {browse && (
              <ButtonLink href={browse.href} size="lg" variant="outline" leftIcon={<Icon.BookOpen className="size-4" />}>
                {browse.label}
              </ButtonLink>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-ink-muted">
            {instructors.length > 0 && (
              <div className="flex items-center gap-2.5">
                <AvatarGroup users={instructors} size="sm" max={4} />
                <span>{t.rich("home.hero.taughtBy", { count: instructors.length, b: (chunks) => <span className="font-medium text-ink">{chunks}</span> })}</span>
              </div>
            )}
            {averageRating && reviewCount > 0 && (
              <div className="flex items-center gap-1.5">
                <Icon.StarFilled className="size-4 text-warning" aria-hidden="true" />
                <span>
                  {t.rich("home.hero.averageRating", {
                    rating: f.number(averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                    count: reviewCount,
                    reviews: compactCount(reviewCount, f.locale),
                    b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
                  })}
                </span>
              </div>
            )}
            {courseCount > 0 && learnerCount > 0 && (
              <div className="flex items-center gap-1.5">
                <Icon.Users className="size-4" aria-hidden="true" />
                <span>
                  {t.rich("home.hero.learnersEnrolled", {
                    count: learnerCount,
                    learners: compactCount(learnerCount, f.locale),
                    b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
                  })}
                </span>
              </div>
            )}
          </div>
        </div>

        {spotlight && (
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div aria-hidden="true" className="absolute -inset-3 -z-10 rotate-2 rounded-3xl bg-accent/10" />
            <Link
              href={`/courses/${spotlight.slug}`}
              className="group block overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-pop transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <CourseCover title={spotlight.title} imageUrl={spotlight.imageUrl} gradient={spotlight.cardGradient} className="aspect-video w-full">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-ink shadow-sm">
                  <Icon.Award className="size-3 text-warning" aria-hidden="true" />
                  {spotlight.featured ? t("home.hero.featuredCourse") : t("home.hero.popularCourse")}
                </span>
              </CourseCover>
              <div className="p-5">
                {spotlight.category && <p className="text-xs font-semibold uppercase tracking-wide text-accent">{spotlight.category.name}</p>}
                <p className="mt-1 text-lg font-semibold leading-snug text-ink group-hover:text-accent">{spotlight.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{spotlight.shortIntroduction}</p>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
                    {spotlight.lessonCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Icon.BookOpen className="size-4" aria-hidden="true" />
                        {t("catalog.lessonCount", { count: spotlight.lessonCount })}
                      </span>
                    )}
                    {spotlight.totalDurationSeconds > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Icon.Clock className="size-4" aria-hidden="true" />
                        {f.duration(spotlight.totalDurationSeconds)}
                      </span>
                    )}
                  </span>
                  <PriceTag course={spotlight} />
                </div>
              </div>
            </Link>
            {spotlight.averageRating && spotlight.reviewCount > 0 && (
              <div className="absolute -start-3 top-8 hidden items-center gap-2 rounded-xl border border-border bg-surface-1 px-3 py-2 shadow-pop sm:flex">
                <Icon.StarFilled className="size-5 text-warning" aria-hidden="true" />
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-ink">
                    {t("home.hero.rating", { rating: f.number(spotlight.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
                  </p>
                  <p className="text-[11px] text-ink-muted">{t("catalog.reviewCount", { count: spotlight.reviewCount })}</p>
                </div>
              </div>
            )}
            {(spotlight.enableCertification || spotlight.paidCertificate) && (
              <div className="absolute -end-3 bottom-24 hidden items-center gap-2 rounded-xl border border-border bg-surface-1 px-3 py-2 shadow-pop sm:flex">
                <span className="flex size-8 items-center justify-center rounded-lg bg-success/12 text-success">
                  <Icon.GraduationCap className="size-4.5" aria-hidden="true" />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-ink">{t("home.hero.certificate")}</p>
                  <p className="text-[11px] text-ink-muted">
                    {spotlight.paidCertificate ? t("home.hero.certificateAfterEvaluation") : t("home.hero.certificateOnCompletion")}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

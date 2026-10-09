import Link from "next/link";
import type { ReactNode } from "react";
import type { Category, Settings } from "@/lib/types";
import type { LandingBatch, LandingStats, Testimonial } from "@/lib/data/catalog";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";
import { compactCount } from "../format";
import { RatingStars } from "../rating-stars";

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

export function LandingSection({
  id,
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && <p className="mb-1 text-micro font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>}
          <h2 id={id} className="text-2xl font-bold tracking-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-ink-faint">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function SeeAllLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
      {children}
      <Icon.ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export async function LandingStatsBand({ stats, showCertificates }: { stats: LandingStats; showCertificates: boolean }) {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const items: { id: string; label: string; value: number; icon: ReactNode }[] = [
    { id: "courses", label: t("home.stats.courses", { count: stats.courses }), value: stats.courses, icon: <Icon.BookOpen /> },
    { id: "lessons", label: t("home.stats.lessons", { count: stats.lessons }), value: stats.lessons, icon: <Icon.Layers /> },
    { id: "learners", label: t("home.stats.learners", { count: stats.learners }), value: stats.learners, icon: <Icon.Users /> },
    ...(showCertificates
      ? [{ id: "certificates", label: t("home.stats.certificates", { count: stats.certificates }), value: stats.certificates, icon: <Icon.Award /> }]
      : []),
    { id: "instructors", label: t("home.stats.instructors", { count: stats.instructors }), value: stats.instructors, icon: <Icon.GraduationCap /> },
  ];
  return (
    <section aria-label={t("home.stats.label")}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-card border border-border bg-surface-1 p-4 shadow-card">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent [&>svg]:size-5" aria-hidden="true">
              {item.icon}
            </span>
            <div className="flex min-w-0 flex-col-reverse">
              <dt className="truncate text-xs text-ink-muted">{item.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums tracking-tight text-ink">{compactCount(item.value, f.locale)}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

function categoryIcon(category: Category): ReactNode {
  const key = `${category.slug} ${category.name}`.toLowerCase();
  if (/web|front|back|full/.test(key)) return <Icon.Globe />;
  if (/program|code|software|develop/.test(key)) return <Icon.Code />;
  if (/design|ux|ui|art/.test(key)) return <Icon.Palette />;
  if (/data|analytic|machine|ai|science/.test(key)) return <Icon.BarChart />;
  if (/business|market|finance|startup|management/.test(key)) return <Icon.Briefcase />;
  if (/security|cyber/.test(key)) return <Icon.Shield />;
  if (/cloud|devops|infra/.test(key)) return <Icon.Database />;
  return <Icon.Layers />;
}

export async function LandingCategories({ categories }: { categories: (Category & { courseCount: number })[] }) {
  if (!categories.length) return null;
  const t = await getT("public");
  return (
    <LandingSection
      id="landing-categories"
      eyebrow={t("home.categories.eyebrow")}
      title={t("home.categories.title")}
      description={t("home.categories.description")}
      action={<SeeAllLink href="/courses">{t("home.categories.seeAll")}</SeeAllLink>}
    >
      <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              href={`/courses?category=${category.slug}`}
              className="group flex h-full items-center gap-3 rounded-card border border-border bg-surface-1 p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
            >
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted transition-colors group-hover:bg-accent group-hover:text-accent-fg [&>svg]:size-5"
                aria-hidden="true"
              >
                {categoryIcon(category)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{category.name}</span>
                <span className="block text-xs text-ink-muted">{t("catalog.courseCount", { count: category.courseCount })}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}

/* ------------------------------------------------------------------ */
/* Batches                                                             */
/* ------------------------------------------------------------------ */

export async function LandingBatches({ batches }: { batches: LandingBatch[] }) {
  if (!batches.length) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const batchWhen = (batch: LandingBatch): string =>
    batch.status === "active" ? t("home.batches.runningUntil", { date: f.date(batch.endDate) }) : t("home.batches.startsIn", { days: batch.startsInDays });
  return (
    <LandingSection
      id="landing-batches"
      eyebrow={t("home.batches.eyebrow")}
      title={t("home.batches.title")}
      description={t("home.batches.description")}
      action={<SeeAllLink href="/batches">{t("home.batches.seeAll")}</SeeAllLink>}
    >
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {batches.map((batch) => (
          <li key={batch.id}>
            <Link
              href={`/batches/${batch.slug}`}
              className="group flex h-full flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-pop motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <div className="flex items-center justify-between gap-2">
                {batch.status === "active" ? (
                  <Badge tone="success" dot>
                    {t("home.batches.liveNow")}
                  </Badge>
                ) : (
                  <Badge tone="info">
                    <Icon.Calendar className="size-3" aria-hidden="true" />
                    {t("home.batches.upcoming")}
                  </Badge>
                )}
                <span className="text-sm font-semibold text-ink">{batch.paidBatch ? f.price(batch.amount, batch.currency, t("catalog.free")) : t("catalog.free")}</span>
              </div>
              <h3 className="mt-3 text-lg font-semibold leading-snug text-ink group-hover:text-accent">{batch.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{batch.description}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-ink-muted">
                <li className="flex items-center gap-2">
                  <Icon.Calendar className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  {t("home.batches.range", { start: f.date(batch.startDate), end: f.date(batch.endDate) })}
                </li>
                <li className="flex items-center gap-2">
                  <Icon.Clock className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  {t("home.batches.range", { start: f.clock(batch.startTime), end: f.clock(batch.endTime) })}{" "}
                  <span className="truncate text-ink-faint">({batch.timezone})</span>
                </li>
                <li className="flex items-center gap-2">
                  {batch.medium === "online" ? (
                    <Icon.Monitor className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  ) : (
                    <Icon.MapPin className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  )}
                  {batch.medium === "online" ? t("home.batches.online") : t("home.batches.inPerson")}
                  {batch.seatsLeft !== null && (
                    <span className={cn("ms-auto text-xs font-medium", batch.seatsLeft <= 5 ? "text-warning" : "text-ink-muted")}>
                      {batch.seatsLeft === 0 ? t("home.batches.fullyBooked") : t("home.batches.seatsLeft", { count: batch.seatsLeft })}
                    </span>
                  )}
                </li>
              </ul>
              <div className="mt-auto pt-5">
                <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <AvatarGroup users={batch.instructors} size="xs" max={3} />
                    <span className="truncate text-xs text-ink-muted">{f.list(batch.instructors.map((i) => i.name.split(" ")[0] ?? i.name))}</span>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-accent">{batchWhen(batch)}</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

export async function LandingFeatures({ features }: { features: Settings["features"] }) {
  const t = await getT("public");
  const items: { id: string; title: string; body: string; icon: ReactNode; enabled: boolean }[] = [
    { id: "video", title: t("home.features.video.title"), body: t("home.features.video.body"), icon: <Icon.Video />, enabled: true },
    { id: "quizzes", title: t("home.features.quizzes.title"), body: t("home.features.quizzes.body"), icon: <Icon.ListChecks />, enabled: true },
    {
      id: "exercises",
      title: t("home.features.exercises.title"),
      body: t("home.features.exercises.body"),
      icon: <Icon.Code />,
      enabled: features.programmingExercises,
    },
    { id: "assignments", title: t("home.features.assignments.title"), body: t("home.features.assignments.body"), icon: <Icon.ClipboardList />, enabled: true },
    { id: "live", title: t("home.features.live.title"), body: t("home.features.live.body"), icon: <Icon.Radio />, enabled: features.liveClasses },
    {
      id: "certificates",
      title: t("home.features.certificates.title"),
      body: t("home.features.certificates.body"),
      icon: <Icon.Certificate />,
      enabled: features.certifications,
    },
    { id: "notes", title: t("home.features.notes.title"), body: t("home.features.notes.body"), icon: <Icon.Note />, enabled: features.notes },
    { id: "badges", title: t("home.features.badges.title"), body: t("home.features.badges.body"), icon: <Icon.Flame />, enabled: features.badges },
  ];
  const shown = items.filter((i) => i.enabled).slice(0, 6);
  return (
    <LandingSection
      id="landing-features"
      eyebrow={t("home.features.eyebrow")}
      title={t("home.features.title")}
      description={t("home.features.description")}
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((item) => (
          <li key={item.id} className="rounded-card border border-border bg-surface-1 p-5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent [&>svg]:size-5" aria-hidden="true">
              {item.icon}
            </span>
            <h3 className="mt-4 font-semibold text-ink">{item.title}</h3>
            <p className="mt-1 text-sm leading-6 text-ink-muted">{item.body}</p>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}

/* ------------------------------------------------------------------ */
/* Testimonials                                                        */
/* ------------------------------------------------------------------ */

export async function LandingTestimonials({ testimonials }: { testimonials: Testimonial[] }) {
  if (!testimonials.length) return null;
  const tr = await getT("public");
  return (
    <LandingSection id="landing-testimonials" title={tr("home.testimonials.title")}>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {testimonials.map((t) => (
          <li key={t.id}>
            <figure className="flex h-full flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card">
              <figcaption className="flex items-center gap-3">
                <Avatar name={t.user.name} src={t.user.avatarUrl} size="sm" />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-semibold text-ink">{t.user.name}</p>
                  <p className="truncate text-xs text-ink-faint">
                    {tr.rich("home.testimonials.onCourse", {
                      link: () => (
                        <Link href={`/courses/${t.course.slug}`} className="font-medium text-accent hover:underline">
                          {t.course.title}
                        </Link>
                      ),
                    })}
                  </p>
                </div>
                <RatingStars value={t.rating} size="sm" className="ms-auto shrink-0" />
              </figcaption>
              <blockquote className="mt-4 flex-1 text-sm leading-6 text-ink-muted">
                <p>{t.review}</p>
              </blockquote>
            </figure>
          </li>
        ))}
      </ul>
    </LandingSection>
  );
}

/* ------------------------------------------------------------------ */
/* Final call to action                                                */
/* ------------------------------------------------------------------ */

export async function LandingCta({
  brandName,
  signupEnabled,
  browse,
}: {
  brandName: string;
  signupEnabled: boolean;
  /** Secondary catalog link; null hides it. */
  browse: { href: string; label: string } | null;
}) {
  const t = await getT("public");
  return (
    <section aria-labelledby="landing-cta" className="relative isolate overflow-hidden rounded-3xl bg-accent px-6 py-12 text-center text-accent-fg sm:px-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-15"
        style={{ backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)", backgroundSize: "20px 20px" }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 -z-10 size-64 rounded-full bg-accent-fg/10 blur-2xl" />
      <h2 id="landing-cta" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("home.cta.title", { brand: brandName })}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm opacity-90 sm:text-base">{signupEnabled ? t("home.cta.bodySignup") : t("home.cta.bodyLogin")}</p>
      <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
        <Link
          href={signupEnabled ? "/register" : "/login"}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent-fg px-5 text-base font-medium text-accent shadow-sm transition-opacity hover:opacity-90"
        >
          {signupEnabled ? t("home.cta.createAccount") : t("home.cta.logIn")}
          <Icon.ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
        {browse && (
          <ButtonLink href={browse.href} size="lg" variant="ghost" className="text-accent-fg ring-1 ring-accent-fg/40 hover:bg-accent-fg/10">
            {browse.label}
          </ButtonLink>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Why learn with us (four small tiles)                                */
/* ------------------------------------------------------------------ */

const VALUES = [
  { key: "depth", icon: "BookOpen", tint: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  { key: "practice", icon: "Code", tint: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  { key: "certificate", icon: "Award", tint: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  { key: "community", icon: "MessageSquare", tint: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
] as const;

/** Four one-line promises under the course rows (the certificate tile only when certificates are on). */
export async function LandingValues({ certificates }: { certificates: boolean }) {
  const t = await getT("public");
  const values = VALUES.filter((v) => v.key !== "certificate" || certificates);
  return (
    <section aria-label={t("home.values.label")}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {values.map((v) => {
          const IconCmp = Icon[v.icon];
          return (
            <li key={v.key} className="flex items-center gap-3 rounded-card border border-border bg-surface-1 p-4">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", v.tint)}>
                <IconCmp className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">{t(`home.values.${v.key}.title`)}</span>
                <span className="block text-xs text-ink-faint">{t(`home.values.${v.key}.body`)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

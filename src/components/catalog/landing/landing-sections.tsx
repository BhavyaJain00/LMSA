import Link from "next/link";
import type { ReactNode } from "react";
import type { Category, Settings } from "@/lib/types";
import type { LandingBatch, LandingStats, Testimonial } from "@/lib/data/catalog";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { cn, formatClock, formatDate, formatPrice } from "@/lib/utils";
import { compactCount, plural } from "../format";
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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>}
          <h2 id={id} className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {title}
          </h2>
          {description && <p className="mt-2 text-sm leading-6 text-ink-muted sm:text-base">{description}</p>}
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
      <Icon.ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function LandingStatsBand({ stats, showCertificates }: { stats: LandingStats; showCertificates: boolean }) {
  const items: { label: string; value: number; icon: ReactNode }[] = [
    { label: plural(stats.courses, "Course"), value: stats.courses, icon: <Icon.BookOpen /> },
    { label: plural(stats.lessons, "Lesson"), value: stats.lessons, icon: <Icon.Layers /> },
    { label: plural(stats.learners, "Learner"), value: stats.learners, icon: <Icon.Users /> },
    ...(showCertificates ? [{ label: plural(stats.certificates, "Certificate") + " issued", value: stats.certificates, icon: <Icon.Award /> }] : []),
    { label: plural(stats.instructors, "Instructor"), value: stats.instructors, icon: <Icon.GraduationCap /> },
  ];
  return (
    <section aria-label="Platform statistics">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3 rounded-card border border-border bg-surface-1 p-4 shadow-card">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent [&>svg]:size-5" aria-hidden="true">
              {item.icon}
            </span>
            <div className="flex min-w-0 flex-col-reverse">
              <dt className="truncate text-xs text-ink-muted">{item.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums tracking-tight text-ink">{compactCount(item.value)}</dd>
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

export function LandingCategories({ categories }: { categories: (Category & { courseCount: number })[] }) {
  if (!categories.length) return null;
  return (
    <LandingSection
      id="landing-categories"
      eyebrow="Explore"
      title="Browse by category"
      description="Pick a topic and see every course we offer in it."
      action={<SeeAllLink href="/courses">All courses</SeeAllLink>}
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
                <span className="block text-xs text-ink-muted">
                  {category.courseCount} {plural(category.courseCount, "course")}
                </span>
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

function batchWhen(batch: LandingBatch): string {
  if (batch.status === "active") return `Running until ${formatDate(batch.endDate)}`;
  if (batch.startsInDays === 0) return "Starts today";
  if (batch.startsInDays === 1) return "Starts tomorrow";
  return `Starts in ${batch.startsInDays} days`;
}

export function LandingBatches({ batches }: { batches: LandingBatch[] }) {
  if (!batches.length) return null;
  return (
    <LandingSection
      id="landing-batches"
      eyebrow="Learn together"
      title="Live and upcoming batches"
      description="Join a cohort for live classes, a schedule to keep you on track and feedback from instructors."
      action={<SeeAllLink href="/batches">See all batches</SeeAllLink>}
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
                    Live now
                  </Badge>
                ) : (
                  <Badge tone="info">
                    <Icon.Calendar className="size-3" aria-hidden="true" />
                    Upcoming
                  </Badge>
                )}
                <span className="text-sm font-semibold text-ink">{batch.paidBatch ? formatPrice(batch.amount, batch.currency) : "Free"}</span>
              </div>
              <h3 className="mt-3 text-lg font-semibold leading-snug text-ink group-hover:text-accent">{batch.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{batch.description}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-ink-muted">
                <li className="flex items-center gap-2">
                  <Icon.Calendar className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  {formatDate(batch.startDate)} – {formatDate(batch.endDate)}
                </li>
                <li className="flex items-center gap-2">
                  <Icon.Clock className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  {formatClock(batch.startTime)} – {formatClock(batch.endTime)} <span className="truncate text-ink-faint">({batch.timezone})</span>
                </li>
                <li className="flex items-center gap-2">
                  {batch.medium === "online" ? (
                    <Icon.Monitor className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  ) : (
                    <Icon.MapPin className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  )}
                  {batch.medium === "online" ? "Online" : "In person"}
                  {batch.seatsLeft !== null && (
                    <span className={cn("ml-auto text-xs font-medium", batch.seatsLeft <= 5 ? "text-warning" : "text-ink-muted")}>
                      {batch.seatsLeft === 0 ? "Fully booked" : `${batch.seatsLeft} ${plural(batch.seatsLeft, "seat")} left`}
                    </span>
                  )}
                </li>
              </ul>
              <div className="mt-auto pt-5">
                <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <AvatarGroup users={batch.instructors} size="xs" max={3} />
                    <span className="truncate text-xs text-ink-muted">{batch.instructors.map((i) => i.name.split(" ")[0]).join(", ")}</span>
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

export function LandingFeatures({ features }: { features: Settings["features"] }) {
  const items: { title: string; body: string; icon: ReactNode; enabled: boolean }[] = [
    {
      title: "Video lessons",
      body: "Watch at your own pace with chapters, speed control and captions. Your position is remembered.",
      icon: <Icon.Video />,
      enabled: true,
    },
    { title: "Quizzes", body: "Check your understanding with instant feedback and explanations after every attempt.", icon: <Icon.ListChecks />, enabled: true },
    {
      title: "Hands-on exercises",
      body: "Write real code in the browser and run it against test cases before moving on.",
      icon: <Icon.Code />,
      enabled: features.programmingExercises,
    },
    { title: "Assignments", body: "Submit projects and get graded feedback from instructors and evaluators.", icon: <Icon.ClipboardList />, enabled: true },
    { title: "Live classes", body: "Join scheduled sessions with your cohort and catch up on recordings later.", icon: <Icon.Radio />, enabled: features.liveClasses },
    {
      title: "Certificates",
      body: "Earn verifiable certificates when you complete a course or pass an evaluation.",
      icon: <Icon.Certificate />,
      enabled: features.certifications,
    },
    { title: "Notes & highlights", body: "Keep timestamped notes next to every lesson and find them again in seconds.", icon: <Icon.Note />, enabled: features.notes },
    { title: "Badges & streaks", body: "Build a daily learning habit and collect badges for your milestones.", icon: <Icon.Flame />, enabled: features.badges },
  ];
  const shown = items.filter((i) => i.enabled).slice(0, 6);
  return (
    <LandingSection
      id="landing-features"
      eyebrow="How you'll learn"
      title="Everything you need to actually finish a course"
      description="Short lessons, practice right where you learn and progress you can see."
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((item) => (
          <li key={item.title} className="rounded-card border border-border bg-surface-1 p-5">
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

export function LandingTestimonials({ testimonials }: { testimonials: Testimonial[] }) {
  if (!testimonials.length) return null;
  return (
    <LandingSection id="landing-testimonials" eyebrow="Learner stories" title="What learners are saying" description="Real reviews from people who took our courses.">
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {testimonials.map((t) => (
          <li key={t.id}>
            <figure className="flex h-full flex-col rounded-card border border-border bg-surface-1 p-6 shadow-card">
              <RatingStars value={t.rating} size="sm" />
              <blockquote className="mt-4 flex-1 text-base leading-7 text-ink">
                <p>
                  <span aria-hidden="true" className="mr-0.5 text-2xl leading-none text-accent">
                    “
                  </span>
                  {t.review}
                  <span aria-hidden="true" className="ml-0.5 text-2xl leading-none text-accent">
                    ”
                  </span>
                </p>
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                <Avatar name={t.user.name} src={t.user.avatarUrl} size="sm" />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-ink">{t.user.name}</p>
                  <p className="truncate text-xs text-ink-muted">
                    on{" "}
                    <Link href={`/courses/${t.course.slug}`} className="font-medium text-accent hover:underline">
                      {t.course.title}
                    </Link>
                  </p>
                </div>
              </figcaption>
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

export function LandingCta({
  brandName,
  signupEnabled,
  browse,
}: {
  brandName: string;
  signupEnabled: boolean;
  /** Secondary catalog link; null hides it. */
  browse: { href: string; label: string } | null;
}) {
  return (
    <section aria-labelledby="landing-cta" className="relative isolate overflow-hidden rounded-3xl bg-accent px-6 py-12 text-center text-accent-fg sm:px-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-15"
        style={{ backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)", backgroundSize: "20px 20px" }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 -z-10 size-64 rounded-full bg-accent-fg/10 blur-2xl" />
      <h2 id="landing-cta" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Start learning on {brandName} today
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm opacity-90 sm:text-base">
        {signupEnabled
          ? "Create a free account to enroll in courses, track your progress and earn certificates."
          : "Log in to enroll in courses, track your progress and earn certificates."}
      </p>
      <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
        <Link
          href={signupEnabled ? "/register" : "/login"}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent-fg px-5 text-base font-medium text-accent shadow-sm transition-opacity hover:opacity-90"
        >
          {signupEnabled ? "Create your free account" : "Log in"}
          <Icon.ArrowRight className="size-4" aria-hidden="true" />
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

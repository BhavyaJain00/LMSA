import Link from "next/link";
import type { ReactNode } from "react";
import type { CourseSummary, Settings } from "@/lib/types";
import type { Testimonial } from "@/lib/data/catalog";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { RatingStars } from "../rating-stars";
import { CourseCard } from "../course-card";
import { Tilt } from "@/components/landing3d/tilt";
import { Emphasis, Eyebrow, SectionHeading } from "./editorial";
import { DISPLAY } from "./fonts";
import { LandingSteps } from "./landing-steps";
import { SpotlightCard, type SpotlightTone } from "./spotlight-card";

/* ------------------------------------------------------------------ */
/* Course cards that tilt in 3D                                         */
/* ------------------------------------------------------------------ */

/** Up to three course cards in a row, each tilting towards the mouse. */
export function TiltCourseGrid({ courses, empty }: { courses: CourseSummary[]; empty?: ReactNode }) {
  if (!courses.length) return <>{empty ?? null}</>;
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <li key={course.id} className="min-w-0">
          <Tilt max={7} className="h-full rounded-card">
            <CourseCard course={course} />
          </Tilt>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Our approach                                                         */
/* ------------------------------------------------------------------ */

/** Centred statement with an underlined italic phrase and three short promises. */
export async function LandingApproach() {
  const t = await getT("public");
  const pillars = [
    { icon: <Icon.Clock className="size-4" />, text: t("home.approach.pace") },
    { icon: <Icon.Code className="size-4" />, text: t("home.approach.practice") },
    { icon: <Icon.MessageSquare className="size-4" />, text: t("home.approach.feedback") },
  ];
  return (
    <section aria-labelledby="landing-approach" className="mx-auto flex max-w-4xl flex-col items-center py-6 text-center sm:py-10">
      <Eyebrow>{t("home.approach.eyebrow")}</Eyebrow>
      <h2 id="landing-approach" className={cn("mt-6 text-4xl font-bold leading-[1.15] tracking-tight text-ink sm:text-5xl lg:text-6xl", DISPLAY)}>
        {t("home.approach.title")} <Emphasis squiggle>{t("home.approach.emphasis")}</Emphasis>
      </h2>
      <div className="mt-8 max-w-2xl space-y-3">
        <p className="text-base leading-relaxed text-ink sm:text-lg">{t("home.approach.lead")}</p>
        <p className="text-sm leading-relaxed text-ink-muted sm:text-base">{t("home.approach.body")}</p>
      </div>
      <ul className="mt-10 flex flex-col items-center gap-4 text-sm font-medium text-ink sm:flex-row sm:gap-0">
        {pillars.map((p, i) => (
          <li key={p.text} className={cn("flex items-center gap-2 px-6", i < pillars.length - 1 && "sm:border-e sm:border-border-strong")}>
            <span className="text-accent" aria-hidden="true">
              {p.icon}
            </span>
            {p.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* What you get (feature cards)                                         */
/* ------------------------------------------------------------------ */

type BentoKey = "video" | "practice" | "live" | "certificate" | "community";

/** Column spans on large screens for 1–5 cards, so every row of the 12-column grid is full. */
const SPANS: Record<number, string[]> = {
  1: ["lg:col-span-12"],
  2: ["lg:col-span-7", "lg:col-span-5"],
  3: ["lg:col-span-7", "lg:col-span-5", "lg:col-span-12"],
  4: ["lg:col-span-7", "lg:col-span-5", "lg:col-span-5", "lg:col-span-7"],
  5: ["lg:col-span-7", "lg:col-span-5", "lg:col-span-5", "lg:col-span-3", "lg:col-span-4"],
};

const TONE: Record<BentoKey, SpotlightTone> = { video: "accent", practice: "violet", live: "orange", certificate: "sky", community: "yellow" };

/** Feature cards for what the platform actually has switched on. */
export async function LandingBento({ features }: { features: Settings["features"] }) {
  const t = await getT("public");
  const keys: BentoKey[] = ["video", "practice"];
  if (features.liveClasses) keys.push("live");
  if (features.certifications) keys.push("certificate");
  if (features.discussions) keys.push("community");
  const spans = SPANS[keys.length] ?? [];

  const body: Record<BentoKey, string> = {
    video: t("home.features.video.body"),
    practice: t("home.bento.practice.body"),
    live: t("home.features.live.body"),
    certificate: t("home.features.certificates.body"),
    community: t("home.bento.community.body"),
  };

  return (
    <section aria-labelledby="landing-bento">
      <SectionHeading
        id="landing-bento"
        eyebrow={t("home.bento.eyebrow")}
        title={t("home.bento.title")}
        emphasis={t("home.bento.emphasis")}
        description={t("home.bento.description")}
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
        {keys.map((key, i) => {
          const keywords = [t(`home.bento.${key}.k1`), t(`home.bento.${key}.k2`), t(`home.bento.${key}.k3`)].filter(
            (k, j) => !(key === "practice" && j === 1 && !features.programmingExercises),
          );
          return (
            <SpotlightCard
              key={key}
              tag={t(`home.bento.${key}.tag`)}
              title={t(`home.bento.${key}.title`)}
              keywords={keywords}
              description={body[key]}
              watermark={t(`home.bento.${key}.tag`)}
              tone={TONE[key]}
              className={spans[i]}
            />
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                         */
/* ------------------------------------------------------------------ */

export async function LandingHowItWorks({ features }: { features: Settings["features"] }) {
  const t = await getT("public");
  const steps = (["find", "learn", "practice", "finish"] as const)
    .filter((key) => key !== "finish" || features.certifications)
    .map((key) => ({
      title: t(`home.steps.${key}.title`),
      summary: t(`home.steps.${key}.summary`),
      chips: [t(`home.steps.${key}.c1`), t(`home.steps.${key}.c2`), t(`home.steps.${key}.c3`)].filter(
        (_, j) => !(key === "practice" && j === 1 && !features.programmingExercises),
      ),
    }));
  return (
    <section aria-labelledby="landing-steps">
      <SectionHeading id="landing-steps" eyebrow={t("home.steps.eyebrow")} title={t("home.steps.title")} emphasis={t("home.steps.emphasis")} />
      <LandingSteps steps={steps} displayClass={DISPLAY} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* What students say                                                    */
/* ------------------------------------------------------------------ */

export async function LandingStories({ testimonials }: { testimonials: Testimonial[] }) {
  if (!testimonials.length) return null;
  const t = await getT("public");
  return (
    <section aria-labelledby="landing-stories">
      <SectionHeading id="landing-stories" eyebrow={t("home.stories.eyebrow")} title={t("home.stories.title")} emphasis={t("home.stories.emphasis")} />
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {testimonials.map((item) => (
          <li key={item.id}>
            <Tilt max={6} className="h-full rounded-3xl">
              <figure className="flex h-full flex-col rounded-3xl border border-border bg-surface-1 p-6 shadow-card">
                <figcaption className="flex items-center gap-3">
                  <Avatar name={item.user.name} src={item.user.avatarUrl} size="sm" />
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-semibold text-ink">{item.user.name}</p>
                    <p className="truncate text-xs text-ink-faint">
                      {t.rich("home.testimonials.onCourse", {
                        link: () => (
                          <Link href={`/courses/${item.course.slug}`} className="font-medium text-accent hover:underline">
                            {item.course.title}
                          </Link>
                        ),
                      })}
                    </p>
                  </div>
                  <RatingStars value={item.rating} size="sm" className="ms-auto shrink-0" />
                </figcaption>
                <blockquote className="mt-4 flex-1 text-base leading-relaxed text-ink-muted">
                  <p>{item.review}</p>
                </blockquote>
              </figure>
            </Tilt>
          </li>
        ))}
      </ul>
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { getFreeResources, privacyPolicyHref } from "@/lib/seo/lead-capture";
import { sectionTrail } from "@/lib/seo/breadcrumbs";
import { pageMetadata } from "@/lib/seo/metadata";
import { CourseGrid } from "@/components/catalog/course-grid";
import { ArticleTeasers } from "@/components/marketing/article-teasers";
import { LeadForm } from "@/components/marketing/lead-form";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { formatDuration } from "@/lib/utils";

const PATH = "/free";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return pageMetadata(
    {
      title: "Free courses and lessons",
      description: [
        `Start learning with ${settings.brand.name} for free: free courses, free preview lessons and practical guides. Subscribe to get new free lessons by email.`,
      ],
      path: PATH,
    },
    settings,
  );
}

const PERKS: { icon: keyof typeof Icon; title: string; body: string }[] = [
  { icon: "Gift", title: "New free lessons", body: "Short, practical lessons from our courses, sent as soon as they are out." },
  { icon: "Rocket", title: "Launch offers first", body: "Hear about new courses and early-bird prices before anyone else." },
  { icon: "ShieldCheck", title: "No spam, ever", body: "A few emails a month. Every email has an unsubscribe link." },
];

/**
 * Lead magnet landing page: the sign-up form (double opt-in), what
 * subscribers get, and everything that is already free: free courses, free
 * preview lessons and the latest articles.
 */
export default async function FreeResourcesPage() {
  const [settings, resources, privacyHref] = await Promise.all([getSettings(), getFreeResources(), privacyPolicyHref()]);
  const { freeCourses, previews, posts, catalogOpen } = resources;

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={sectionTrail("Free resources")} />

      <section aria-labelledby="free-title" className="relative isolate overflow-hidden rounded-3xl border border-border bg-surface-1 px-5 py-10 shadow-card sm:px-10 sm:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 -z-10 size-96 rounded-full bg-accent/15 blur-3xl" />
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
              <Icon.Gift className="size-3.5" aria-hidden="true" />
              Free
            </p>
            <h1 id="free-title" className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-ink text-balance sm:text-5xl">
              Learn something useful this week, for free
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-ink-muted sm:text-lg">
              Join the {settings.brand.name} list for free lessons, practical guides and first access to new courses.
            </p>
            <ul className="mt-6 space-y-3">
              {PERKS.map((perk) => {
                const PerkIcon = Icon[perk.icon];
                return (
                  <li key={perk.title} className="flex gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <PerkIcon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="text-sm">
                      <span className="block font-medium text-ink">{perk.title}</span>
                      <span className="text-ink-muted">{perk.body}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <LeadForm
            source="free"
            variant="hero"
            title="Get free lessons by email"
            description="Enter your email, confirm it, and the first lesson is on its way."
            submitLabel="Send me free lessons"
            privacyHref={privacyHref}
          />
        </div>
      </section>

      {previews.length > 0 && (
        <section aria-labelledby="free-previews" className="mt-14">
          <div className="mb-5">
            <h2 id="free-previews" className="text-2xl font-semibold tracking-tight text-ink">
              Free preview lessons
            </h2>
            <p className="mt-1 text-sm text-ink-muted">Watch these lessons now, no account needed.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {previews.map((lesson) => (
              <li key={lesson.id}>
                <Link
                  href={lesson.href}
                  className="group flex h-full items-start gap-3 rounded-card border border-border bg-surface-1 p-4 shadow-card transition-colors hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <Icon.Play className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 font-medium text-ink group-hover:text-accent">{lesson.title}</span>
                    <span className="mt-1 block truncate text-xs text-ink-muted">
                      {lesson.course.title}
                      {lesson.durationSeconds > 0 && ` · ${formatDuration(lesson.durationSeconds)}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {freeCourses.length > 0 && (
        <section aria-labelledby="free-courses" className="mt-14">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="free-courses" className="text-2xl font-semibold tracking-tight text-ink">
                Free courses
              </h2>
              <p className="mt-1 text-sm text-ink-muted">Complete courses you can take at no cost.</p>
            </div>
            <ButtonLink href="/courses" variant="outline" size="sm" rightIcon={<Icon.ArrowRight className="size-4" />}>
              All courses
            </ButtonLink>
          </div>
          <CourseGrid courses={freeCourses} headingLevel="h3" />
        </section>
      )}

      {posts.length > 0 && (
        <section aria-labelledby="free-articles" className="mt-14">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <h2 id="free-articles" className="text-2xl font-semibold tracking-tight text-ink">
              Free guides on the blog
            </h2>
            <ButtonLink href="/blog" variant="outline" size="sm" rightIcon={<Icon.ArrowRight className="size-4" />}>
              All articles
            </ButtonLink>
          </div>
          <ArticleTeasers posts={posts} />
        </section>
      )}

      {catalogOpen && !previews.length && !freeCourses.length && (
        <p className="mt-14 text-center text-sm text-ink-muted">
          New free lessons are on their way: subscribe above to be the first to know, or{" "}
          <Link href="/courses" className="font-medium text-accent hover:underline">
            browse the courses
          </Link>
          .
        </p>
      )}
    </div>
  );
}

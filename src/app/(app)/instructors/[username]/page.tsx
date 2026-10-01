import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/db/store";
import { catalogIsPublic, courseItemList, getInstructorProfile, requireCatalogAccess } from "@/lib/data/seo";
import { Markdown } from "@/lib/markdown";
import { instructorTrail } from "@/lib/seo/breadcrumbs";
import { instructorPath, profilePath } from "@/lib/seo/content-index";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { decodeSegment, siteOrigin } from "@/lib/seo/site";
import { CourseGrid } from "@/components/catalog/course-grid";
import { ArticleTeasers } from "@/components/marketing/article-teasers";
import { InstructorCard } from "@/components/marketing/instructor-card";
import { SocialLinks } from "@/components/profile/social-icons";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { formatNumber, pluralize } from "@/lib/utils";
import { MessageUserButton } from "@/components/messages/message-button";

export async function generateMetadata(props: PageProps<"/instructors/[username]">): Promise<Metadata> {
  const [{ username }, settings] = await Promise.all([props.params, getSettings()]);
  const profile = settings.features.courses ? await getInstructorProfile(decodeSegment(username) ?? "") : null;
  if (!profile) return notFoundMetadata("Instructor not found");
  const { instructor, courses } = profile;
  return pageMetadata(
    {
      title: instructor.headline ? `${instructor.name} — ${instructor.headline}` : `${instructor.name}, instructor`,
      description: [
        instructor.bio,
        `${instructor.name} teaches ${pluralize(courses.length, "course")} on ${settings.brand.name}${courses.length ? `, including ${courses.slice(0, 3).map((c) => c.title).join(", ")}` : ""}.`,
      ],
      path: instructorPath(instructor.username),
      type: "profile",
      // The generated share card (./opengraph-image.tsx) shows the name, headline and numbers.
      generatedImage: true,
      keywords: [instructor.name, ...instructor.skills.slice(0, 6), ...instructor.categories],
      noindex: !catalogIsPublic(settings),
      follow: true,
    },
    settings,
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-surface-1 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted [&>svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <dd className="text-lg font-semibold leading-tight tabular-nums text-ink">{value}</dd>
        <dt className="truncate text-xs text-ink-muted">{label}</dt>
      </div>
    </div>
  );
}

export default async function InstructorPage(props: PageProps<"/instructors/[username]">) {
  const { username: rawUsername } = await props.params;
  const username = decodeSegment(rawUsername);
  if (!username) notFound();
  const { user } = await requireCatalogAccess(instructorPath(username));
  const profile = await getInstructorProfile(username, user);
  if (!profile) notFound();

  const { instructor, socials, courses, posts, colleagues, jsonLd } = profile;
  const firstName = instructor.name.split(/\s+/)[0] ?? instructor.name;

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={instructorTrail(instructor.name)} />
      <JsonLd data={[jsonLd, courseItemList(`Courses by ${instructor.name}`, courses, { origin: siteOrigin() })]} />

      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <Avatar name={instructor.name} src={instructor.avatarUrl} size="2xl" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Instructor</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{instructor.name}</h1>
          {instructor.headline && <p className="mt-2 text-base text-ink-muted sm:text-lg">{instructor.headline}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
            {instructor.location && (
              <span className="inline-flex items-center gap-1.5">
                <Icon.MapPin className="size-4" aria-hidden="true" />
                {instructor.location}
              </span>
            )}
            <SocialLinks socials={socials} name={instructor.name} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="#courses" size="sm">
              See {firstName}&apos;s courses
            </ButtonLink>
            <ButtonLink href={profilePath(instructor.username)} size="sm" variant="outline">
              Full profile
            </ButtonLink>
            <MessageUserButton userId={instructor.id} label="Message instructor" />
          </div>
        </div>
      </header>

      <dl className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat icon={<Icon.BookOpen />} value={formatNumber(instructor.courseCount)} label={instructor.courseCount === 1 ? "Course" : "Courses"} />
        <Stat icon={<Icon.Users />} value={formatNumber(instructor.learnerCount)} label={instructor.learnerCount === 1 ? "Learner" : "Learners"} />
        {instructor.averageRating !== null ? (
          <Stat icon={<Icon.StarFilled />} value={instructor.averageRating.toFixed(1)} label={`Average rating (${pluralize(instructor.reviewCount, "review")})`} />
        ) : (
          <Stat icon={<Icon.Tag />} value={formatNumber(instructor.categories.length)} label={instructor.categories.length === 1 ? "Subject area" : "Subject areas"} />
        )}
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="instructor-about-heading" className="min-w-0">
          <h2 id="instructor-about-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            About {firstName}
          </h2>
          {instructor.bio ? (
            <Markdown content={instructor.bio} />
          ) : (
            <p className="text-base leading-7 text-ink-muted">
              {instructor.name} teaches {pluralize(courses.length, "course")}
              {instructor.categories.length > 0 && <> in {instructor.categories.slice(0, 3).join(", ")}</>}. Browse the courses below to see what you can learn.
            </p>
          )}
        </section>
        {(instructor.skills.length > 0 || instructor.categories.length > 0) && (
          <aside aria-label={`What ${instructor.name} knows`} className="min-w-0 space-y-6">
            {instructor.skills.length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-semibold text-ink">Skills</h2>
                <ul className="flex flex-wrap gap-2">
                  {instructor.skills.map((skill) => (
                    <li key={skill}>
                      <Tag className="px-2.5 py-1 text-sm text-ink">{skill}</Tag>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {instructor.categories.length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-semibold text-ink">Teaches</h2>
                <ul className="space-y-1 text-sm text-ink-muted">
                  {instructor.categories.map((name) => (
                    <li key={name} className="flex items-center gap-2">
                      <Icon.Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>

      <section id="courses" aria-labelledby="instructor-courses-heading" className="mt-12 scroll-mt-20">
        <h2 id="instructor-courses-heading" className="mb-4 text-xl font-semibold tracking-tight text-ink">
          Courses by {instructor.name}
        </h2>
        <CourseGrid courses={courses} headingLevel="h3" />
      </section>

      {posts.length > 0 && (
        <section aria-labelledby="instructor-articles-heading" className="mt-12">
          <h2 id="instructor-articles-heading" className="mb-4 text-xl font-semibold tracking-tight text-ink">
            Articles by {firstName}
          </h2>
          <ArticleTeasers posts={posts} />
        </section>
      )}

      {colleagues.length > 0 && (
        <section aria-labelledby="instructor-more-heading" className="mt-12">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="instructor-more-heading" className="text-xl font-semibold tracking-tight text-ink">
              More instructors
            </h2>
            <Link href="/instructors" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              All instructors
              <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {colleagues.map((colleague) => (
              <li key={colleague.id} className="min-w-0">
                <InstructorCard instructor={colleague} headingLevel="h3" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

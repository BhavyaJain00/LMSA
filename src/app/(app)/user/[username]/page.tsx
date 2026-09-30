import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/db/store";
import { getProfileBadges, getProfileView, getRequestOrigin, getTeachingCourses, profileCompleteness } from "@/lib/data/profile";
import { Markdown } from "@/lib/markdown";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Tag } from "@/components/ui/badge";
import { DashboardCourseCard } from "@/components/dashboard/cards";
import { BadgeGrid } from "@/components/profile/badge-grid";
import { EducationTimeline, ProfileCompletenessCard, WorkTimeline } from "@/components/profile/profile-sections";
import { SocialLinks } from "@/components/profile/social-icons";
import { formatDate, relativeTime } from "@/lib/utils";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { guestsCanBrowse } from "@/lib/seo/visibility";
import { profilePath } from "@/lib/seo/content-index";
import { getProfileJsonLd } from "@/lib/data/seo";
import { JsonLd } from "@/components/seo/json-ld";

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Profiles of people who teach a published course are public landing pages
 * (indexed, with ProfilePage/Person markup); learner profiles stay out of the
 * index so joining the platform never puts someone's name in search results.
 */
function isIndexableProfile(view: NonNullable<Awaited<ReturnType<typeof getProfileView>>>, guestsBrowse: boolean): boolean {
  return guestsBrowse && view.user.enabled && view.stats.teaching > 0;
}

export async function generateMetadata(props: PageProps<"/user/[username]">): Promise<Metadata> {
  const { username } = await props.params;
  const [view, settings] = await Promise.all([getProfileView(decodeURIComponent(username)), getSettings()]);
  if (!view) return notFoundMetadata("Profile not found");
  const { user } = view;
  return pageMetadata(
    {
      title: user.headline ? `${user.name} — ${user.headline}` : user.name,
      description: [user.bio, user.headline, `${user.name} on ${settings.brand.name}.`],
      path: profilePath(user.username),
      type: "profile",
      image: user.avatarUrl ? { url: user.avatarUrl, alt: user.name } : undefined,
      noindex: !isIndexableProfile(view, guestsCanBrowse(settings)),
      follow: true,
    },
    settings,
  );
}

export default async function ProfileAboutPage(props: PageProps<"/user/[username]">) {
  const { username } = await props.params;
  const view = await getProfileView(decodeURIComponent(username));
  if (!view) notFound();
  const { user, isSelf } = view;
  const settings = await getSettings();
  const [badges, teaching, origin] = await Promise.all([
    settings.features.badges ? getProfileBadges(user.id) : Promise.resolve([]),
    getTeachingCourses(user.id),
    getRequestOrigin(),
  ]);
  const completeness = profileCompleteness(user);
  const base = `/user/${user.username}`;
  const hasExperience = !!user.workExperience?.length;
  const hasEducation = !!user.education?.length;
  const website = user.socials?.website;
  const structuredData = isIndexableProfile(view, guestsCanBrowse(settings)) ? await getProfileJsonLd(user) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <JsonLd data={structuredData} />
      <div className="min-w-0 space-y-8 lg:col-span-2">
        <Section title="About">
          {user.bio ? (
            <Markdown content={user.bio} />
          ) : (
            <p className="text-sm italic text-ink-muted">
              No introduction
              {isSelf && (
                <>
                  {" — "}
                  <Link href={`${base}/edit`} className="not-italic font-medium text-accent hover:underline">
                    add a bio
                  </Link>
                </>
              )}
            </p>
          )}
        </Section>

        {!!user.skills?.length && (
          <Section title="Skills">
            <ul className="flex flex-wrap gap-2">
              {user.skills.map((s) => (
                <li key={s}>
                  <Tag className="px-2.5 py-1 text-sm text-ink">{s}</Tag>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {hasExperience && (
          <Section title="Work experience">
            <WorkTimeline items={user.workExperience!} />
          </Section>
        )}

        {hasEducation && (
          <Section title="Education">
            <EducationTimeline items={user.education!} />
          </Section>
        )}

        {badges.length > 0 && (
          <Section
            title="Achievements"
            action={
              view.viewer && badges.length > 5 ? (
                <Link href={`${base}/badges`} className="text-xs font-medium text-ink-muted hover:text-accent">
                  View all
                </Link>
              ) : undefined
            }
          >
            <BadgeGrid badges={badges.slice(0, 5)} isSelf={isSelf} profileUrl={`${origin}${base}`} appName={settings.brand.name} compact />
          </Section>
        )}

        {teaching.length > 0 && (
          <Section
            title={`Courses by ${user.name.split(" ")[0]}`}
            action={
              <Link href={`/courses`} className="text-xs font-medium text-ink-muted hover:text-accent">
                Browse all courses
              </Link>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {teaching.map((c) => (
                <DashboardCourseCard key={c.id} course={c} />
              ))}
            </div>
          </Section>
        )}
      </div>

      <aside className="min-w-0 space-y-6" aria-label="Profile details">
        {isSelf && completeness.percent < 100 && (
          <ProfileCompletenessCard percent={completeness.percent} items={completeness.items} editHref={`${base}/edit`} />
        )}

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Details</h2>
          <dl className="space-y-2.5 text-sm">
            {user.location && (
              <div className="flex items-start gap-2.5">
                <dt className="sr-only">Location</dt>
                <Icon.MapPin className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <dd className="text-ink">{user.location}</dd>
              </div>
            )}
            {view.canSeeEmail && user.email && (
              <div className="flex items-start gap-2.5">
                <dt className="sr-only">Email</dt>
                <Icon.Mail className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <dd className="min-w-0 break-all text-ink">{user.email}</dd>
              </div>
            )}
            {website && (
              <div className="flex items-start gap-2.5">
                <dt className="sr-only">Website</dt>
                <Icon.Link className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <dd className="min-w-0">
                  <a href={website} target="_blank" rel="noopener noreferrer me" className="break-all text-accent hover:underline">
                    {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                </dd>
              </div>
            )}
            <div className="flex items-start gap-2.5">
              <dt className="sr-only">Member since</dt>
              <Icon.Calendar className="mt-0.5 size-4 shrink-0 text-ink-faint" />
              <dd className="text-ink">Member since {formatDate(user.createdAt)}</dd>
            </div>
            {user.lastActiveAt && (
              <div className="flex items-start gap-2.5">
                <dt className="sr-only">Last active</dt>
                <Icon.Clock className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <dd className="text-ink">Active {relativeTime(user.lastActiveAt)}</dd>
              </div>
            )}
          </dl>
          <SocialLinks socials={user.socials} name={user.name} className="mt-3 border-t border-border pt-3" />
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Learning</h2>
          <dl className="grid grid-cols-2 gap-3">
            {[
              { label: "Courses", value: view.stats.enrolled, icon: <Icon.BookOpen className="size-4" /> },
              { label: "Completed", value: view.stats.completed, icon: <Icon.Trophy className="size-4" /> },
              { label: "Lessons done", value: view.stats.lessonsCompleted, icon: <Icon.CheckCircle className="size-4" /> },
              { label: "Certificates", value: view.stats.certificates, icon: <Icon.Certificate className="size-4" /> },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-surface-2 p-3">
                <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
                  {s.icon}
                  {s.label}
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{s.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {view.canSeeEmail && user.persona && (user.persona.role || user.persona.goals?.length) && (
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Learning goals</h2>
              {isSelf && (
                <Link href="/persona" className="text-xs font-medium text-ink-muted hover:text-accent">
                  Update
                </Link>
              )}
            </div>
            <p className="text-xs text-ink-faint">Only visible to {isSelf ? "you" : "moderators"}.</p>
            <dl className="mt-3 space-y-2 text-sm">
              {user.persona.role && (
                <div>
                  <dt className="text-xs text-ink-muted">Describes themselves as</dt>
                  <dd className="text-ink">{user.persona.role}</dd>
                </div>
              )}
              {user.persona.industry && (
                <div>
                  <dt className="text-xs text-ink-muted">Industry</dt>
                  <dd className="text-ink">{user.persona.industry}</dd>
                </div>
              )}
              {!!user.persona.goals?.length && (
                <div>
                  <dt className="text-xs text-ink-muted">Goals</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {user.persona.goals.map((g) => (
                      <Tag key={g}>{g}</Tag>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        )}
      </aside>
    </div>
  );
}

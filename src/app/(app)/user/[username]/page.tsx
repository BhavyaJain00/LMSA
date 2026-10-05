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
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { guestsCanBrowse } from "@/lib/seo/visibility";
import { isIndexableProfile } from "@/lib/seo/profile-card";
import { instructorPath, profilePath } from "@/lib/seo/content-index";
import { canonicalUrl } from "@/lib/seo/site";
import { getProfileJsonLd } from "@/lib/data/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { getFormatter, getLocale, getT } from "@/i18n/server";

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

export async function generateMetadata(props: PageProps<"/user/[username]">): Promise<Metadata> {
  const { username } = await props.params;
  const [view, settings, t, locale] = await Promise.all([getProfileView(decodeURIComponent(username)), getSettings(), getT("account"), getLocale()]);
  if (!view) return notFoundMetadata(t("profile.notFound"));
  const { user } = view;
  const indexable = isIndexableProfile(view, guestsCanBrowse(settings));
  return pageMetadata(
    {
      title: user.headline ? `${user.name} — ${user.headline}` : user.name,
      description: [user.bio, user.headline, t("profile.metaDescription", { name: user.name, brand: settings.brand.name })],
      path: profilePath(user.username),
      type: "profile",
      // The generated share card (./opengraph-image.tsx): name, headline, picture and numbers for
      // indexable profiles, the default site card for everyone else (never a learner's picture or numbers).
      generatedImage: true,
      noindex: !indexable,
      follow: true,
      // Teachers also have an instructor page with the same person: that one is the canonical address.
      canonicalOverride: indexable && settings.features.courses ? canonicalUrl(instructorPath(user.username)) : undefined,
      locale,
    },
    settings,
  );
}

export default async function ProfileAboutPage(props: PageProps<"/user/[username]">) {
  const { username } = await props.params;
  const view = await getProfileView(decodeURIComponent(username));
  if (!view) notFound();
  const { user, isSelf } = view;
  const [settings, t, tc, f] = await Promise.all([getSettings(), getT("account"), getT("common"), getFormatter()]);
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
        <Section title={t("profile.about.title")}>
          {user.bio ? (
            <Markdown content={user.bio} />
          ) : (
            <p className="text-sm italic text-ink-muted">
              {isSelf
                ? t.rich("profile.about.emptySelf", {
                    link: (text) => (
                      <Link href={`${base}/edit`} className="not-italic font-medium text-accent hover:underline">
                        {text}
                      </Link>
                    ),
                  })
                : t("profile.about.empty")}
            </p>
          )}
        </Section>

        {!!user.skills?.length && (
          <Section title={t("profile.about.skills")}>
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
          <Section title={t("profile.about.work")}>
            <WorkTimeline items={user.workExperience!} />
          </Section>
        )}

        {hasEducation && (
          <Section title={t("profile.about.education")}>
            <EducationTimeline items={user.education!} />
          </Section>
        )}

        {badges.length > 0 && (
          <Section
            title={t("profile.about.achievements")}
            action={
              view.viewer && badges.length > 5 ? (
                <Link href={`${base}/badges`} className="text-xs font-medium text-ink-muted hover:text-accent">
                  {tc("actions.viewAll")}
                </Link>
              ) : undefined
            }
          >
            <BadgeGrid badges={badges.slice(0, 5)} isSelf={isSelf} profileUrl={`${origin}${base}`} appName={settings.brand.name} compact />
          </Section>
        )}

        {teaching.length > 0 && (
          <Section
            title={t("profile.about.coursesBy", { name: user.name.split(" ")[0] })}
            action={
              <Link href={`/courses`} className="text-xs font-medium text-ink-muted hover:text-accent">
                {t("profile.about.browseCourses")}
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

      <aside className="min-w-0 space-y-6" aria-label={t("profile.details.label")}>
        {isSelf && completeness.percent < 100 && (
          <ProfileCompletenessCard percent={completeness.percent} items={completeness.items} editHref={`${base}/edit`} />
        )}

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("profile.details.title")}</h2>
          <dl className="space-y-2.5 text-sm">
            {user.location && (
              <div className="flex items-start gap-2.5">
                <dt className="sr-only">{t("profile.details.location")}</dt>
                <Icon.MapPin className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <dd className="text-ink">{user.location}</dd>
              </div>
            )}
            {view.canSeeEmail && user.email && (
              <div className="flex items-start gap-2.5">
                <dt className="sr-only">{t("profile.details.email")}</dt>
                <Icon.Mail className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <dd className="min-w-0 break-all text-ink">{user.email}</dd>
              </div>
            )}
            {website && (
              <div className="flex items-start gap-2.5">
                <dt className="sr-only">{t("profile.details.website")}</dt>
                <Icon.Link className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <dd className="min-w-0">
                  <a href={website} target="_blank" rel="noopener noreferrer me" className="break-all text-accent hover:underline">
                    {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                </dd>
              </div>
            )}
            <div className="flex items-start gap-2.5">
              <dt className="sr-only">{t("profile.details.memberSinceLabel")}</dt>
              <Icon.Calendar className="mt-0.5 size-4 shrink-0 text-ink-faint" />
              <dd className="text-ink">{t("profile.details.memberSince", { date: f.date(user.createdAt) })}</dd>
            </div>
            {user.lastActiveAt && (
              <div className="flex items-start gap-2.5">
                <dt className="sr-only">{t("profile.details.lastActiveLabel")}</dt>
                <Icon.Clock className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <dd className="text-ink">{t("profile.details.lastActive", { when: f.relative(user.lastActiveAt) })}</dd>
              </div>
            )}
          </dl>
          <SocialLinks socials={user.socials} name={user.name} className="mt-3 border-t border-border pt-3" />
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("profile.learning.title")}</h2>
          <dl className="grid grid-cols-2 gap-3">
            {[
              { key: "courses", label: t("profile.learning.courses"), value: view.stats.enrolled, icon: <Icon.BookOpen className="size-4" /> },
              { key: "completed", label: t("profile.learning.completed"), value: view.stats.completed, icon: <Icon.Trophy className="size-4" /> },
              { key: "lessons", label: t("profile.learning.lessonsDone"), value: view.stats.lessonsCompleted, icon: <Icon.CheckCircle className="size-4" /> },
              { key: "certificates", label: t("profile.learning.certificates"), value: view.stats.certificates, icon: <Icon.Certificate className="size-4" /> },
            ].map((s) => (
              <div key={s.key} className="rounded-lg bg-surface-2 p-3">
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
              <h2 className="text-sm font-semibold text-ink">{t("profile.goals.title")}</h2>
              {isSelf && (
                <Link href="/persona" className="text-xs font-medium text-ink-muted hover:text-accent">
                  {t("profile.goals.update")}
                </Link>
              )}
            </div>
            <p className="text-xs text-ink-faint">{isSelf ? t("profile.goals.visibleSelf") : t("profile.goals.visibleModerators")}</p>
            <dl className="mt-3 space-y-2 text-sm">
              {user.persona.role && (
                <div>
                  <dt className="text-xs text-ink-muted">{t("profile.goals.role")}</dt>
                  <dd className="text-ink">{user.persona.role}</dd>
                </div>
              )}
              {user.persona.industry && (
                <div>
                  <dt className="text-xs text-ink-muted">{t("profile.goals.industry")}</dt>
                  <dd className="text-ink">{user.persona.industry}</dd>
                </div>
              )}
              {!!user.persona.goals?.length && (
                <div>
                  <dt className="text-xs text-ink-muted">{t("profile.goals.goals")}</dt>
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

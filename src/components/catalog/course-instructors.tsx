import Link from "next/link";
import type { PublicUser } from "@/lib/types";
import type { InstructorStats } from "@/lib/data/catalog";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { Markdown } from "@/lib/markdown";
import { MessageUserButton } from "@/components/messages/message-button";
import { instructorPath, profilePath } from "@/lib/seo/content-index";
import { getFormatter, getT } from "@/i18n/server";
import { compactCount } from "./format";

/**
 * Instructor cards: avatar, name, headline, teaching stats and a short bio.
 * On a public course the cards link to the instructors' teaching pages
 * (`/instructors/<username>`, which exist for anyone teaching a public
 * course); otherwise to their member profiles.
 */
export async function CourseInstructors({
  instructors,
  stats,
  teachingProfiles = false,
}: {
  instructors: PublicUser[];
  stats: Map<string, InstructorStats>;
  teachingProfiles?: boolean;
}) {
  if (!instructors.length) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  return (
    <section aria-labelledby="instructors-heading">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{t("course.instructors.eyebrow", { count: instructors.length })}</p>
      <h2 id="instructors-heading" className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {t("course.instructors.title", { count: instructors.length })}
      </h2>
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {instructors.map((instructor) => {
          const s = stats.get(instructor.id);
          const profile = teachingProfiles ? instructorPath(instructor.username) : profilePath(instructor.username);
          return (
            <li key={instructor.id} className="flex flex-col rounded-card border border-border bg-surface-1 p-5">
              <div className="flex items-start gap-4">
                <Link href={profile} className="shrink-0 rounded-full" aria-label={t("course.instructors.profileOf", { name: instructor.name })}>
                  <Avatar name={instructor.name} src={instructor.avatarUrl} size="lg" />
                </Link>
                <div className="min-w-0">
                  <Link href={profile} className="block truncate text-base font-semibold text-ink hover:text-accent hover:underline">
                    {instructor.name}
                  </Link>
                  {instructor.headline && <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{instructor.headline}</p>}
                  {instructor.location && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-faint">
                      <Icon.MapPin className="size-3.5" aria-hidden="true" />
                      {instructor.location}
                    </p>
                  )}
                </div>
              </div>
              {s && (
                <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-center">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{t("home.stats.courses", { count: s.courseCount })}</dt>
                    <dd className="text-sm font-semibold text-ink">{f.number(s.courseCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{t("course.instructors.students", { count: s.studentCount })}</dt>
                    <dd className="text-sm font-semibold text-ink">{compactCount(s.studentCount, f.locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{t("course.instructors.rating")}</dt>
                    <dd className="inline-flex items-center justify-center gap-1 text-sm font-semibold text-ink">
                      {s.averageRating ? (
                        <>
                          <Icon.StarFilled className="size-3.5 text-warning" aria-hidden="true" />
                          {f.number(s.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        </>
                      ) : (
                        <span className="font-normal text-ink-faint">—</span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}
              {instructor.bio && (
                <div className="mt-4 line-clamp-3 text-sm">
                  <Markdown content={instructor.bio} className="text-sm! text-ink-muted!" />
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                <Link href={profile} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  {t("course.instructors.viewProfile")}
                  <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                </Link>
                {/* Round 3 comms: shown only to members allowed to message this instructor. */}
                <MessageUserButton userId={instructor.id} label={t("course.instructors.message")} size="xs" />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

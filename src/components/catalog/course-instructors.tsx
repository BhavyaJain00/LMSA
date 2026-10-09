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
import { MetaDots, SectionCard } from "./course-page/section-card";

/**
 * "Your instructor(s)" card: one row per instructor with the avatar, name, headline, a single line of teaching
 * stats (courses · students · rating), a two-line bio and the profile / message actions. On a public course the
 * rows link to the instructors' teaching pages (`/instructors/<username>`, which exist for anyone teaching a
 * public course); otherwise to their member profiles (where the location and full bio live).
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
    <SectionCard id="instructors" headingId="instructors-heading" title={t("course.instructors.title", { count: instructors.length })}>
      <ul className="divide-y divide-border">
        {instructors.map((instructor) => {
          const s = stats.get(instructor.id);
          const profile = teachingProfiles ? instructorPath(instructor.username) : profilePath(instructor.username);
          const rating = s?.averageRating ? f.number(s.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null;
          return (
            <li key={instructor.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
              <Link href={profile} className="shrink-0 self-start rounded-full" aria-label={t("course.instructors.profileOf", { name: instructor.name })}>
                <Avatar name={instructor.name} src={instructor.avatarUrl} size="lg" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={profile} className="block truncate text-base font-bold text-ink hover:text-accent hover:underline">
                  {instructor.name}
                </Link>
                {instructor.headline && <p className="mt-0.5 line-clamp-1 text-sm text-ink-muted">{instructor.headline}</p>}
                {s && (
                  <MetaDots
                    className="mt-1 text-meta text-ink-faint"
                    parts={[
                      t("course.instructors.courseCount", { count: s.courseCount }),
                      t("card.students", { count: s.studentCount, formatted: compactCount(s.studentCount, f.locale) }),
                      rating ? (
                        <span className="inline-flex items-center gap-1">
                          <Icon.StarFilled className="size-3.5 text-warning" aria-hidden="true" />
                          <span aria-hidden="true">{rating}</span>
                          <span className="sr-only">{t("course.instructors.ratingValue", { rating })}</span>
                        </span>
                      ) : null,
                    ]}
                  />
                )}
                {instructor.bio && (
                  <div className="mt-2 line-clamp-2 text-sm">
                    <Markdown content={instructor.bio} className="text-sm! text-ink-muted!" />
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Link href={profile} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
                    {t("course.instructors.viewProfile")}
                    <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                  </Link>
                  {/* Round 3 comms: shown only to members allowed to message this instructor. */}
                  <MessageUserButton userId={instructor.id} label={t("course.instructors.message")} size="xs" />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

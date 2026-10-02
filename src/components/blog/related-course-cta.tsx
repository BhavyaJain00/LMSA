import Link from "next/link";
import type { CourseSummary } from "@/lib/types";
import { coursePath } from "@/lib/seo/content-index";
import { CourseCover } from "@/components/catalog/course-cover";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getT } from "@/i18n/server";

/**
 * Call to action for the course an article recommends: cover, title, short
 * introduction, a few facts and a "View course" button. Further recommended
 * courses are listed as compact links. Server Component.
 */
export async function RelatedCourseCta({ courses }: { courses: CourseSummary[] }) {
  const [main, ...more] = courses;
  if (!main) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  return (
    <section aria-labelledby="course-cta-heading" className="overflow-hidden rounded-card border border-accent/30 bg-accent/5">
      <div className="grid gap-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="relative aspect-video sm:aspect-auto sm:h-full">
          <CourseCover title={main.title} imageUrl={main.imageUrl} gradient={main.cardGradient} className="absolute inset-0 size-full" />
        </div>
        <div className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">{t("blog.courseCta.eyebrow")}</p>
          <h2 id="course-cta-heading" className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {main.title}
          </h2>
          {main.shortIntroduction && <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-ink-muted">{main.shortIntroduction}</p>}
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
            <span>{t("catalog.lessonCount", { count: main.lessonCount })}</span>
            {main.enrollmentCount > 0 && <span>{t("enroll.includes.enrolled", { amount: f.count(main.enrollmentCount) })}</span>}
            {main.averageRating !== null && (
              <span className="inline-flex items-center gap-1">
                <Icon.StarFilled className="size-3 text-warning" aria-hidden="true" />
                {f.number(main.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </span>
            )}
          </p>
          <ButtonLink href={coursePath(main.slug)} className="mt-4" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
            {t("certification.viewCourse")}
          </ButtonLink>
        </div>
      </div>
      {more.length > 0 && (
        <div className="border-t border-accent/20 px-5 py-3">
          <p className="text-xs font-medium text-ink-muted">{t("blog.courseCta.more")}</p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {more.map((c) => (
              <li key={c.id}>
                <Link href={coursePath(c.slug)} className="text-sm font-medium text-accent hover:underline">
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

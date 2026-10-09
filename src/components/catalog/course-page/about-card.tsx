import Link from "next/link";
import type { CourseSummary } from "@/lib/types";
import { Icon } from "@/components/ui/icons";
import { Markdown } from "@/lib/markdown";
import { categoryPath, tagPath } from "@/lib/seo/content-index";
import { tagSlug } from "@/lib/seo/text";
import { getT } from "@/i18n/server";
import { SectionCard } from "./section-card";
import { ShowMore } from "./show-more";

/**
 * "About this course": the description, what you'll learn and the requirements in one card, clamped to about
 * four lines with "Show more". The category and tags stay underneath as small topic links.
 */
export async function AboutCard({
  description,
  outcomes,
  requirements,
  category,
  tags,
}: {
  description: string;
  outcomes: string[];
  requirements: string[];
  category: CourseSummary["category"];
  tags: string[];
}) {
  const hasText = !!description.trim() || outcomes.length > 0 || requirements.length > 0;
  const hasTopics = !!category || tags.length > 0;
  if (!hasText && !hasTopics) return null;
  const t = await getT("public");
  return (
    <SectionCard id="about" headingId="about-heading" title={t("course.sections.about")}>
      {hasText && (
        <ShowMore>
          <div className="space-y-6">
            {description.trim() && (
              // Headings written in the description stay smaller than the card title.
              <Markdown
                content={description}
                className="text-ink-muted! [&_:is(h1,h2,h3,h4)]:text-body! [&_:is(h1,h2,h3,h4)]:font-bold! [&_:is(h1,h2,h3,h4)]:text-ink!"
              />
            )}
            {outcomes.length > 0 && (
              <div>
                <h3 className="text-body font-bold text-ink">{t("course.sections.outcomes")}</h3>
                <ul className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {outcomes.map((outcome, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm leading-6 text-ink">
                      <Icon.Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
                      <span>{outcome}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {requirements.length > 0 && (
              <div>
                <h3 className="text-body font-bold text-ink">{t("course.sections.requirements")}</h3>
                <ul className="mt-3 space-y-2">
                  {requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm leading-6 text-ink-muted">
                      <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink-faint" aria-hidden="true" />
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ShowMore>
      )}
      {hasTopics && (
        <div className={hasText ? "mt-5 border-t border-border pt-4" : undefined}>
          <ul className="flex flex-wrap gap-2" aria-label={t("course.page.topics")}>
            {category && (
              <li>
                <Link
                  href={categoryPath(category.slug)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-meta font-semibold text-ink transition-colors hover:bg-surface-3"
                >
                  <Icon.Tag className="size-3.5 text-ink-faint" aria-hidden="true" />
                  {category.name}
                </Link>
              </li>
            )}
            {tags.map((tag) => (
              <li key={tag}>
                <Link
                  href={tagSlug(tag) ? tagPath(tagSlug(tag)) : `/courses?search=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center rounded-full bg-surface-2 px-3 py-1 text-meta font-medium text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

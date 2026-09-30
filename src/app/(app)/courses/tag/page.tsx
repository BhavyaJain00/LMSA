import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { catalogIsPublic, getCategoryDirectory, getCourseTags, requireCatalogAccess } from "@/lib/data/seo";
import { tagTrail } from "@/lib/seo/breadcrumbs";
import { categoryPath, tagPath } from "@/lib/seo/content-index";
import { itemListJsonLd } from "@/lib/seo/jsonld";
import { isTagIndexable } from "@/lib/seo/landing";
import { pageMetadata } from "@/lib/seo/metadata";
import { siteOrigin } from "@/lib/seo/site";
import { ChipLinks } from "@/components/marketing/chip-links";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { pluralize } from "@/lib/utils";

const PATH = "/courses/tag";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const tags = settings.features.courses ? await getCourseTags() : [];
  return pageMetadata(
    {
      title: "Course topics",
      description: [
        `Find ${settings.brand.name} courses by topic${tags.length ? `: ${tags.slice(0, 8).map((t) => t.label).join(", ")} and more` : ""}. Each topic lists every course that covers it.`,
      ],
      path: PATH,
      noindex: tags.length === 0 || !catalogIsPublic(settings),
      follow: true,
    },
    settings,
  );
}

/** Topics grouped by first letter (digits and symbols under "#"), each group sorted by name. */
function groupByLetter<T extends { label: string }>(tags: T[]): { letter: string; tags: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const tag of [...tags].sort((a, b) => a.label.localeCompare(b.label))) {
    const first = tag.label.trim().charAt(0).toUpperCase();
    const letter = /\p{L}/u.test(first) ? first : "#";
    groups.set(letter, [...(groups.get(letter) ?? []), tag]);
  }
  return [...groups].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))).map(([letter, list]) => ({ letter, tags: list }));
}

export default async function TagIndexPage() {
  await requireCatalogAccess(PATH);
  const [tags, categories] = await Promise.all([getCourseTags(), getCategoryDirectory()]);
  const popular = tags.slice(0, 12);
  const groups = groupByLetter(tags);
  const indexable = tags.filter((t) => isTagIndexable(t.count));

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={tagTrail()} />
      {indexable.length > 0 && <JsonLd data={itemListJsonLd("Course topics", indexable.map((t) => ({ name: t.label, path: tagPath(t.slug) })), { origin: siteOrigin() })} />}

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Course topics</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-ink-muted">
          {tags.length > 0 ? `${pluralize(tags.length, "topic")} taught across the catalog. ` : ""}Pick a topic to see every course that covers it.
        </p>
      </header>

      {tags.length === 0 ? (
        <EmptyState
          icon={<Icon.Hash />}
          title="No topics yet"
          description="Topics come from the tags of published courses and will be listed here."
          action={<ButtonLink href="/courses">Browse all courses</ButtonLink>}
        />
      ) : (
        <>
          <section aria-labelledby="topics-popular-heading">
            <h2 id="topics-popular-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
              Most popular
            </h2>
            <ChipLinks label="Most popular topics" items={popular.map((t) => ({ href: tagPath(t.slug), label: t.label, count: t.count }))} />
          </section>

          <section aria-labelledby="topics-all-heading" className="mt-12">
            <h2 id="topics-all-heading" className="mb-4 text-xl font-semibold tracking-tight text-ink">
              All topics A–Z
            </h2>
            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((group) => (
                <div key={group.letter} className="min-w-0">
                  <h3 className="border-b border-border pb-1 text-sm font-semibold text-ink-faint">{group.letter}</h3>
                  <ul className="mt-2 space-y-1.5">
                    {group.tags.map((t) => (
                      <li key={t.slug} className="flex items-baseline justify-between gap-3 text-sm">
                        <Link href={tagPath(t.slug)} className="min-w-0 truncate text-ink hover:text-accent hover:underline">
                          {t.label}
                        </Link>
                        <span className="shrink-0 text-xs tabular-nums text-ink-muted">{t.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {categories.length > 0 && (
        <section aria-labelledby="topics-categories-heading" className="mt-12">
          <h2 id="topics-categories-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            Browse by category
          </h2>
          <ChipLinks label="Course categories" items={categories.map((c) => ({ href: categoryPath(c.slug), label: c.name, count: c.courseCount }))} />
        </section>
      )}
    </div>
  );
}

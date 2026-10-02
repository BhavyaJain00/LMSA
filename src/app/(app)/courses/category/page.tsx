import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/db/store";
import { catalogIsPublic, getCategoryDirectory, getCourseTags, requireCatalogAccess } from "@/lib/data/seo";
import { categoryIndexTrail } from "@/lib/seo/breadcrumbs";
import { categoryPath, tagPath } from "@/lib/seo/content-index";
import { itemListJsonLd } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/metadata";
import { siteOrigin } from "@/lib/seo/site";
import { ChipLinks } from "@/components/marketing/chip-links";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { getLocale, getT } from "@/i18n/server";

const PATH = "/courses/category";

export async function generateMetadata(): Promise<Metadata> {
  const [settings, t, locale] = await Promise.all([getSettings(), getT("public"), getLocale()]);
  const categories = settings.features.courses ? await getCategoryDirectory() : [];
  return pageMetadata(
    {
      title: t("categories.title"),
      description: [
        categories.length
          ? t("categories.meta.descriptionWithList", { brand: settings.brand.name, list: categories.slice(0, 6).map((c) => c.name).join(", ") })
          : t("categories.meta.description", { brand: settings.brand.name }),
      ],
      path: PATH,
      locale,
      noindex: categories.length === 0 || !catalogIsPublic(settings),
      follow: true,
    },
    settings,
  );
}

export default async function CategoryIndexPage() {
  await requireCatalogAccess(PATH);
  const [categories, tags, t] = await Promise.all([getCategoryDirectory(), getCourseTags(), getT("public")]);

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={categoryIndexTrail()} />
      {categories.length > 0 && <JsonLd data={itemListJsonLd("Course categories", categories.map((c) => ({ name: c.name, path: categoryPath(c.slug) })), { origin: siteOrigin() })} />}

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t("categories.title")}</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-ink-muted">{t("categories.intro")}</p>
      </header>

      {categories.length === 0 ? (
        <EmptyState
          icon={<Icon.Tag />}
          title={t("categories.emptyTitle")}
          description={t("categories.emptyDescription")}
          action={<ButtonLink href="/courses">{t("landing.browseAll")}</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <li key={category.id} className="min-w-0">
              <article className="group relative flex h-full flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card transition-shadow hover:shadow-pop focus-within:ring-2 focus-within:ring-accent/60">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-lg font-semibold tracking-tight text-ink">
                    <Link href={categoryPath(category.slug)} className="outline-none before:absolute before:inset-0 before:content-[''] group-hover:text-accent">
                      {category.name}
                    </Link>
                  </h2>
                  <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-muted">{t("catalog.courseCount", { count: category.courseCount })}</span>
                </div>
                {category.blurb && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted">{category.blurb}</p>}
                <ul className="mt-3 space-y-1 text-sm text-ink-muted" aria-label={t("categories.popularIn", { category: category.name })}>
                  {category.sampleCourses.map((title) => (
                    <li key={title} className="flex items-start gap-2">
                      <Icon.BookOpen className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                      <span className="line-clamp-1">{title}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ul>
      )}

      {tags.length > 0 && (
        <section aria-labelledby="category-index-topics" className="mt-12">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="category-index-topics" className="text-xl font-semibold tracking-tight text-ink">
              {t("categories.popularTopics")}
            </h2>
            <Link href="/courses/tag" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              {t("categories.allTopics")}
              <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
          <ChipLinks label={t("categories.popularTopics")} items={tags.slice(0, 20).map((tag) => ({ href: tagPath(tag.slug), label: tag.label, count: tag.count }))} />
        </section>
      )}
    </div>
  );
}

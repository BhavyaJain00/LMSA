import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getSettings } from "@/lib/db/store";
import { catalogIsPublic, courseItemList, getTagLanding, requireCatalogAccess } from "@/lib/data/seo";
import { tagTrail } from "@/lib/seo/breadcrumbs";
import { categoryPath, tagPath } from "@/lib/seo/content-index";
import { LANDING_PAGE_SIZE, isTagIndexable, landingHref, paginate, parseLandingSort, parsePageParam } from "@/lib/seo/landing";
import { listingIndexing, notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { decodeSegment, siteOrigin } from "@/lib/seo/site";
import { tagSlug } from "@/lib/seo/text";
import { CourseGrid } from "@/components/catalog/course-grid";
import { PageLinks } from "@/components/gamification/page-links";
import { ArticleTeasers } from "@/components/marketing/article-teasers";
import { ChipLinks } from "@/components/marketing/chip-links";
import { SortLinks } from "@/components/marketing/sort-links";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { getLocale, getT } from "@/i18n/server";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The topic named by the URL segment, in its canonical slug form ("Web%20Design" → "web-design"). */
function topicSlug(segment: string): string {
  return tagSlug(decodeSegment(segment) ?? "");
}

export async function generateMetadata(props: PageProps<"/courses/tag/[tag]">): Promise<Metadata> {
  const [{ tag }, sp, settings, t, locale] = await Promise.all([props.params, props.searchParams, getSettings(), getT("public"), getLocale()]);
  const slug = topicSlug(tag);
  const landing = settings.features.courses && slug ? await getTagLanding(slug) : null;
  if (!landing) return notFoundMetadata(t("topics.notFound"));
  const { noindex } = listingIndexing({ sort: firstParam(sp.sort), page: parsePageParam(sp.page) });
  const titles = landing.courses.slice(0, 3).map((c) => c.title);
  return pageMetadata(
    {
      title: t("catalog.meta.categoryTitle", { category: landing.label }),
      description: [
        titles.length
          ? t("topics.meta.landingDescriptionWithTitles", { count: landing.courses.length, topic: landing.label, brand: settings.brand.name, titles: titles.join(", ") })
          : t("topics.meta.landingDescription", { count: landing.courses.length, topic: landing.label, brand: settings.brand.name }),
      ],
      path: tagPath(landing.slug),
      locale,
      keywords: [landing.label, ...landing.relatedTags.slice(0, 8).map((t) => t.label)],
      noindex: noindex || !isTagIndexable(landing.courses.length) || !catalogIsPublic(settings),
      follow: true,
    },
    settings,
  );
}

export default async function TagPage(props: PageProps<"/courses/tag/[tag]">) {
  const [{ tag }, sp] = await Promise.all([props.params, props.searchParams]);
  const slug = topicSlug(tag);
  if (!slug) notFound();
  // Other spellings of a topic ("Web Design", "WEB-DESIGN") move to its one address.
  if (tag !== slug) permanentRedirect(tagPath(slug));
  const { user, settings } = await requireCatalogAccess(tagPath(slug));
  const sort = parseLandingSort(sp.sort);
  const landing = await getTagLanding(slug, sort, user);
  if (!landing) notFound();

  const t = await getT("public");
  const { label, courses, relatedTags, categories, posts } = landing;
  const path = tagPath(landing.slug);
  const paged = paginate(courses, parsePageParam(sp.page), LANDING_PAGE_SIZE);
  const canonicalView = sort === "popular" && paged.page === 1;

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={tagTrail(label)} />
      {canonicalView && <JsonLd data={courseItemList(`${label} courses`, paged.items, { origin: siteOrigin() })} />}

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{t("topics.eyebrow")}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t("catalog.meta.categoryTitle", { category: label })}</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-ink-muted">
          {categories.length === 0
            ? t("topics.intro.plain", { count: courses.length, brand: settings.brand.name, topic: label })
            : categories.length === 1
              ? t("topics.intro.oneCategory", { count: courses.length, brand: settings.brand.name, topic: label, category: categories[0]!.name })
              : t("topics.intro.manyCategories", { count: courses.length, brand: settings.brand.name, topic: label, categories: categories.length })}
        </p>
      </header>

      <section aria-labelledby="tag-courses-heading">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="tag-courses-heading" className="text-xl font-semibold tracking-tight text-ink">
            {t("topics.coursesAbout", { topic: label })}
          </h2>
          {courses.length > 1 && <SortLinks base={path} current={sort} />}
        </div>
        <CourseGrid courses={paged.items} headingLevel="h3" eagerCount={paged.page === 1 ? 4 : 0} />
        <PageLinks className="mt-6" page={paged.page} pageCount={paged.pages} hrefFor={(page) => landingHref(path, { sort, page })} label={t("landing.pages", { name: label })} />
      </section>

      {relatedTags.length > 0 && (
        <section aria-labelledby="tag-related-heading" className="mt-12">
          <h2 id="tag-related-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {t("topics.related")}
          </h2>
          <ChipLinks
            label={t("topics.relatedLabel", { topic: label })}
            items={relatedTags.map((related) => ({ href: tagPath(related.slug), label: related.label, count: related.count }))}
          />
        </section>
      )}

      {categories.length > 0 && (
        <section aria-labelledby="tag-categories-heading" className="mt-12">
          <h2 id="tag-categories-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {t("topics.categoriesWith", { topic: label })}
          </h2>
          <ChipLinks label={t("topics.categoriesWith", { topic: label })} items={categories.map((c) => ({ href: categoryPath(c.slug), label: c.name, count: c.courseCount }))} />
        </section>
      )}

      {posts.length > 0 && (
        <section aria-labelledby="tag-articles-heading" className="mt-12">
          <h2 id="tag-articles-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {t("topics.articlesAbout", { topic: label })}
          </h2>
          <ArticleTeasers posts={posts} />
        </section>
      )}
    </div>
  );
}

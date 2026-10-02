import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/db/store";
import { catalogIsPublic, courseItemList, getCategoryLanding, requireCatalogAccess } from "@/lib/data/seo";
import { Markdown } from "@/lib/markdown";
import { categoryTrail } from "@/lib/seo/breadcrumbs";
import { categoryPath, tagPath } from "@/lib/seo/content-index";
import { LANDING_PAGE_SIZE, landingHref, paginate, parseLandingSort, parsePageParam } from "@/lib/seo/landing";
import { listingIndexing, notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { decodeSegment, siteOrigin } from "@/lib/seo/site";
import { CourseGrid } from "@/components/catalog/course-grid";
import { PageLinks } from "@/components/gamification/page-links";
import { ArticleTeasers } from "@/components/marketing/article-teasers";
import { ChipLinks } from "@/components/marketing/chip-links";
import { InstructorLinks } from "@/components/marketing/instructor-links";
import { SortLinks } from "@/components/marketing/sort-links";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { getFormatter, getLocale, getT } from "@/i18n/server";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(props: PageProps<"/courses/category/[slug]">): Promise<Metadata> {
  const [{ slug }, sp, settings, t, locale] = await Promise.all([props.params, props.searchParams, getSettings(), getT("public"), getLocale()]);
  const landing = settings.features.courses ? await getCategoryLanding(decodeSegment(slug) ?? "") : null;
  if (!landing) return notFoundMetadata(t("categories.notFound"));
  const { category, courses, topics } = landing;
  // Sorted and paged views repeat the first page: they canonicalise to it and stay out of the index.
  const { noindex } = listingIndexing({ sort: firstParam(sp.sort), page: parsePageParam(sp.page) });
  return pageMetadata(
    {
      title: category.seoTitle?.trim() || t("catalog.meta.categoryTitle", { category: category.name }),
      description: category.seoDescription?.trim() || [
        category.intro,
        t("categories.meta.landingDescription", { count: courses.length, category: category.name.toLocaleLowerCase(locale), brand: settings.brand.name }),
      ],
      path: categoryPath(category.slug),
      locale,
      keywords: [category.name, ...topics.slice(0, 8).map((t) => t.label)],
      // An empty category has nothing to rank for.
      noindex: noindex || courses.length === 0 || !catalogIsPublic(settings),
      follow: true,
    },
    settings,
  );
}

export default async function CategoryPage(props: PageProps<"/courses/category/[slug]">) {
  const [{ slug: rawSlug }, sp] = await Promise.all([props.params, props.searchParams]);
  const slug = decodeSegment(rawSlug);
  if (!slug) notFound();
  const { user, settings } = await requireCatalogAccess(categoryPath(slug));
  const sort = parseLandingSort(sp.sort);
  const landing = await getCategoryLanding(slug, sort, user);
  if (!landing) notFound();

  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const { category, courses, otherCategories, topics, posts, instructors } = landing;
  const path = categoryPath(category.slug);
  const paged = paginate(courses, parsePageParam(sp.page), LANDING_PAGE_SIZE);
  const canonicalView = sort === "popular" && paged.page === 1;
  const instructorCount = new Set(courses.flatMap((c) => c.instructorIds)).size;
  const lower = category.name.toLocaleLowerCase(t.locale);

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={categoryTrail(category)} />
      {canonicalView && paged.items.length > 0 && <JsonLd data={courseItemList(`${category.name} courses`, paged.items, { origin: siteOrigin() })} />}

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t("catalog.meta.categoryTitle", { category: category.name })}</h1>
        {courses.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span>{t("catalog.courseCount", { count: courses.length })}</span>
            {landing.learnerCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("landing.enrollments", { count: landing.learnerCount, formatted: f.count(landing.learnerCount) })}</span>
              </>
            )}
            {instructorCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("landing.instructorCount", { count: instructorCount })}</span>
              </>
            )}
          </p>
        )}
        {category.intro ? (
          <Markdown content={category.intro} className="mt-4 max-w-3xl" />
        ) : (
          <p className="mt-4 max-w-3xl text-base leading-7 text-ink-muted">{t("categories.defaultIntro", { category: lower, brand: settings.brand.name })}</p>
        )}
      </header>

      <section aria-labelledby="category-courses-heading">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="category-courses-heading" className="text-xl font-semibold tracking-tight text-ink">
            {t("categories.allCourses", { category: lower })}
          </h2>
          {courses.length > 1 && <SortLinks base={path} current={sort} />}
        </div>
        <CourseGrid
          courses={paged.items}
          headingLevel="h3"
          eagerCount={paged.page === 1 ? 4 : 0}
          empty={
            <EmptyState
              icon={<Icon.BookOpen />}
              title={t("categories.emptyCoursesTitle", { category: lower })}
              description={t("categories.emptyCoursesDescription")}
              action={<ButtonLink href="/courses">{t("landing.browseAll")}</ButtonLink>}
            />
          }
        />
        <PageLinks className="mt-6" page={paged.page} pageCount={paged.pages} hrefFor={(page) => landingHref(path, { sort, page })} label={t("landing.pages", { name: category.name })} />
      </section>

      {topics.length > 0 && (
        <section aria-labelledby="category-topics-heading" className="mt-12">
          <h2 id="category-topics-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {t("categories.topicsIn", { category: lower })}
          </h2>
          <ChipLinks
            label={t("categories.topicsInLabel", { category: category.name })}
            items={topics.map((topic) => ({ href: tagPath(topic.slug), label: topic.label, count: topic.count }))}
          />
        </section>
      )}

      {instructors.length > 0 && (
        <section aria-labelledby="category-instructors-heading" className="mt-12">
          <h2 id="category-instructors-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {t("categories.whoTeaches", { category: lower })}
          </h2>
          <InstructorLinks instructors={instructors} />
        </section>
      )}

      {posts.length > 0 && (
        <section aria-labelledby="category-articles-heading" className="mt-12">
          <h2 id="category-articles-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {t("categories.articles", { category: category.name })}
          </h2>
          <ArticleTeasers posts={posts} />
        </section>
      )}

      {otherCategories.length > 0 && (
        <section aria-labelledby="category-more-heading" className="mt-12">
          <h2 id="category-more-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {t("categories.exploreOther")}
          </h2>
          <ChipLinks label={t("categories.otherLabel")} items={otherCategories.map((c) => ({ href: categoryPath(c.slug), label: c.name, count: c.courseCount }))} />
        </section>
      )}
    </div>
  );
}

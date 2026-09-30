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
import { formatNumber, pluralize } from "@/lib/utils";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(props: PageProps<"/courses/category/[slug]">): Promise<Metadata> {
  const [{ slug }, sp, settings] = await Promise.all([props.params, props.searchParams, getSettings()]);
  const landing = settings.features.courses ? await getCategoryLanding(decodeSegment(slug) ?? "") : null;
  if (!landing) return notFoundMetadata("Category not found");
  const { category, courses, topics } = landing;
  // Sorted and paged views repeat the first page: they canonicalise to it and stay out of the index.
  const { noindex } = listingIndexing({ sort: firstParam(sp.sort), page: parsePageParam(sp.page) });
  return pageMetadata(
    {
      title: category.seoTitle?.trim() || `${category.name} courses`,
      description: category.seoDescription?.trim() || [
        category.intro,
        `Browse ${pluralize(courses.length, `${category.name.toLowerCase()} course`)} on ${settings.brand.name}: self-paced video lessons, quizzes, hands-on assignments and certificates.`,
      ],
      path: categoryPath(category.slug),
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

  const { category, courses, otherCategories, topics, posts, instructors } = landing;
  const path = categoryPath(category.slug);
  const paged = paginate(courses, parsePageParam(sp.page), LANDING_PAGE_SIZE);
  const canonicalView = sort === "popular" && paged.page === 1;
  const instructorCount = new Set(courses.flatMap((c) => c.instructorIds)).size;
  const lower = category.name.toLowerCase();

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={categoryTrail(category)} />
      {canonicalView && paged.items.length > 0 && <JsonLd data={courseItemList(`${category.name} courses`, paged.items, { origin: siteOrigin() })} />}

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{category.name} courses</h1>
        {courses.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span>{pluralize(courses.length, "course")}</span>
            {landing.learnerCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {formatNumber(landing.learnerCount)} {landing.learnerCount === 1 ? "enrollment" : "enrollments"}
                </span>
              </>
            )}
            {instructorCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{pluralize(instructorCount, "instructor")}</span>
              </>
            )}
          </p>
        )}
        {category.intro ? (
          <Markdown content={category.intro} className="mt-4 max-w-3xl" />
        ) : (
          <p className="mt-4 max-w-3xl text-base leading-7 text-ink-muted">
            Learn {lower} at your own pace on {settings.brand.name}. Every course combines video lessons with quizzes and hands-on practice, and you can start with the free preview lessons before you enroll.
          </p>
        )}
      </header>

      <section aria-labelledby="category-courses-heading">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="category-courses-heading" className="text-xl font-semibold tracking-tight text-ink">
            All {lower} courses
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
              title={`No ${lower} courses yet`}
              description="Courses in this category will appear here as soon as they are published."
              action={<ButtonLink href="/courses">Browse all courses</ButtonLink>}
            />
          }
        />
        <PageLinks className="mt-6" page={paged.page} pageCount={paged.pages} hrefFor={(page) => landingHref(path, { sort, page })} label={`${category.name} course pages`} />
      </section>

      {topics.length > 0 && (
        <section aria-labelledby="category-topics-heading" className="mt-12">
          <h2 id="category-topics-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            Popular topics in {lower}
          </h2>
          <ChipLinks label={`Topics in ${category.name}`} items={topics.map((t) => ({ href: tagPath(t.slug), label: t.label, count: t.count }))} />
        </section>
      )}

      {instructors.length > 0 && (
        <section aria-labelledby="category-instructors-heading" className="mt-12">
          <h2 id="category-instructors-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            Who teaches {lower}
          </h2>
          <InstructorLinks instructors={instructors} />
        </section>
      )}

      {posts.length > 0 && (
        <section aria-labelledby="category-articles-heading" className="mt-12">
          <h2 id="category-articles-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {category.name} articles
          </h2>
          <ArticleTeasers posts={posts} />
        </section>
      )}

      {otherCategories.length > 0 && (
        <section aria-labelledby="category-more-heading" className="mt-12">
          <h2 id="category-more-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            Explore other categories
          </h2>
          <ChipLinks label="Other course categories" items={otherCategories.map((c) => ({ href: categoryPath(c.slug), label: c.name, count: c.courseCount }))} />
        </section>
      )}
    </div>
  );
}

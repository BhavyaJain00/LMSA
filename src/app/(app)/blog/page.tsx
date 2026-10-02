import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/db/store";
import { getBlogCategories, getBlogTags, getPublicPosts, publishDuePosts } from "@/lib/data/blog";
import { sectionTrail } from "@/lib/seo/breadcrumbs";
import { blogCategoryPath, blogTagPath, postPath } from "@/lib/seo/content-index";
import { itemListJsonLd } from "@/lib/seo/jsonld";
import { landingHref, parsePageParam } from "@/lib/seo/landing";
import { listingIndexing, notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { siteOrigin } from "@/lib/seo/site";
import { BlogSearch } from "@/components/blog/blog-search";
import { FeaturedPost } from "@/components/blog/featured-post";
import { PageLinks } from "@/components/gamification/page-links";
import { ArticleTeasers } from "@/components/marketing/article-teasers";
import { ChipLinks } from "@/components/marketing/chip-links";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { getLocale, getT } from "@/i18n/server";

const TOP_TAGS = 24;

function searchParam(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, 100);
}

export async function generateMetadata(props: PageProps<"/blog">): Promise<Metadata> {
  const [sp, settings, t, locale] = await Promise.all([props.searchParams, getSettings(), getT("public"), getLocale()]);
  if (!settings.seo.blogEnabled) return notFoundMetadata();
  const q = searchParam(sp.q);
  const page = parsePageParam(sp.page);
  // Search results and later pages canonicalise to /blog and stay out of the index.
  const { noindex } = listingIndexing({ search: q, page });
  const [categories, tags] = await Promise.all([getBlogCategories(), getBlogTags()]);
  return pageMetadata(
    {
      title: q ? t("blog.meta.searchTitle", { search: q }) : t("blog.meta.title"),
      description: [
        categories.length
          ? t("blog.meta.descriptionWithTopics", { brand: settings.brand.name, topics: categories.slice(0, 4).map((c) => c.name.toLowerCase()).join(", ") })
          : t("blog.meta.description", { brand: settings.brand.name }),
      ],
      path: "/blog",
      locale,
      noindex,
      follow: true,
      keywords: [...categories.slice(0, 6).map((c) => c.name), ...tags.slice(0, 6).map((t) => t.label)],
    },
    settings,
  );
}

export default async function BlogIndexPage(props: PageProps<"/blog">) {
  const [sp, settings, t] = await Promise.all([props.searchParams, getSettings(), getT("public")]);
  if (!settings.seo.blogEnabled) notFound();
  await publishDuePosts();

  const q = searchParam(sp.q);
  const [posts, categories, tags] = await Promise.all([getPublicPosts({ search: q, page: parsePageParam(sp.page) }), getBlogCategories(), getBlogTags()]);
  const canonicalView = !q && posts.page === 1;
  const [featured, ...rest] = canonicalView ? posts.items : [];
  const grid = canonicalView ? rest : posts.items;

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={sectionTrail(t("blog.meta.title"))} />
      {canonicalView && posts.items.length > 0 && (
        <JsonLd data={itemListJsonLd(`${settings.brand.name} blog`, posts.items.map((p) => ({ name: p.title, path: postPath(p.slug), image: p.coverImageUrl })), { origin: siteOrigin() })} />
      )}

      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t("blog.index.title", { brand: settings.brand.name })}</h1>
          <p className="mt-2 text-base leading-7 text-ink-muted">{t("blog.index.description")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <BlogSearch query={q} className="sm:w-80" />
          <a href="/blog/rss.xml" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-ink-muted hover:text-accent sm:self-center" title={t("blog.index.rssHint")}>
            <Icon.Radio className="size-4" aria-hidden="true" />
            RSS
          </a>
        </div>
      </header>

      {categories.length > 0 && (
        <nav aria-label={t("blog.index.categories")} className="mb-8">
          <ChipLinks label={t("blog.index.categories")} items={categories.map((c) => ({ href: blogCategoryPath(c.slug), label: c.name, count: c.postCount }))} />
        </nav>
      )}

      {q && (
        <p className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted" role="status">
          <span>
            {t.rich("blog.index.resultsFor", { count: posts.total, search: q, b: (chunks) => <span className="font-medium text-ink">{chunks}</span> })}
          </span>
          <Link href="/blog" className="font-medium text-accent hover:underline">
            {t("blog.index.clearSearch")}
          </Link>
        </p>
      )}

      {featured && (
        <div className="mb-10">
          <FeaturedPost post={featured} />
        </div>
      )}

      {posts.total === 0 ? (
        q ? (
          <EmptyState
            icon={<Icon.Search />}
            title={t("blog.index.noMatchTitle")}
            description={t("blog.index.noMatchDescription")}
            action={<ButtonLink href="/blog">{t("blog.index.showAll")}</ButtonLink>}
          />
        ) : (
          <EmptyState
            icon={<Icon.FileText />}
            title={t("blog.index.emptyTitle")}
            description={t("blog.index.emptyDescription")}
            action={<ButtonLink href="/courses">{t("catalog.browseCourses")}</ButtonLink>}
          />
        )
      ) : (
        grid.length > 0 && (
          <section aria-labelledby="blog-latest-heading">
            <h2 id="blog-latest-heading" className={q ? "sr-only" : "mb-4 text-xl font-semibold tracking-tight text-ink"}>
              {q ? t("blog.index.searchResults") : posts.page === 1 ? t("blog.index.latest") : t("blog.index.page", { page: posts.page })}
            </h2>
            <ArticleTeasers posts={grid} />
          </section>
        )
      )}

      <PageLinks className="mt-8" page={posts.page} pageCount={posts.pages} hrefFor={(page) => landingHref("/blog", { q, page })} label={t("blog.index.pages")} />

      {tags.length > 0 && !q && (
        <section aria-labelledby="blog-topics-heading" className="mt-12">
          <h2 id="blog-topics-heading" className="mb-3 text-xl font-semibold tracking-tight text-ink">
            {t("categories.popularTopics")}
          </h2>
          <ChipLinks label={t("blog.index.topics")} items={tags.slice(0, TOP_TAGS).map((tag) => ({ href: blogTagPath(tag.slug), label: tag.label, count: tag.count }))} />
        </section>
      )}
    </div>
  );
}

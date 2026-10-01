import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/db/store";
import { getBlogCategoryLanding, publishDuePosts } from "@/lib/data/blog";
import { Markdown } from "@/lib/markdown";
import { blogArchiveTrail } from "@/lib/seo/breadcrumbs";
import { blogCategoryPath, categoryPath, postPath } from "@/lib/seo/content-index";
import { itemListJsonLd } from "@/lib/seo/jsonld";
import { parsePageParam } from "@/lib/seo/landing";
import { listingIndexing, notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { decodeSegment, siteOrigin } from "@/lib/seo/site";
import { PostArchive } from "@/components/blog/post-archive";
import { ChipLinks } from "@/components/marketing/chip-links";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";

export async function generateMetadata(props: PageProps<"/blog/category/[slug]">): Promise<Metadata> {
  const [{ slug }, sp, settings] = await Promise.all([props.params, props.searchParams, getSettings()]);
  const page = parsePageParam(sp.page);
  const landing = settings.seo.blogEnabled ? await getBlogCategoryLanding(decodeSegment(slug) ?? "", page) : null;
  if (!landing) return notFoundMetadata("Category not found");
  const { category, posts } = landing;
  const titles = posts.items.slice(0, 3).map((p) => p.title);
  return pageMetadata(
    {
      title: `${category.name} articles`,
      description: [`${posts.total === 1 ? "An article" : `${posts.total} articles`} about ${category.name.toLowerCase()} from ${settings.brand.name}: ${titles.join("; ")}.`],
      path: blogCategoryPath(category.slug),
      ...listingIndexing({ page }),
      keywords: [category.name, `${category.name} articles`, `${category.name} tutorials`],
    },
    settings,
  );
}

export default async function BlogCategoryPage(props: PageProps<"/blog/category/[slug]">) {
  const [{ slug: rawSlug }, sp, settings] = await Promise.all([props.params, props.searchParams, getSettings()]);
  const slug = decodeSegment(rawSlug);
  if (!settings.seo.blogEnabled || !slug) notFound();
  await publishDuePosts();
  const landing = await getBlogCategoryLanding(slug, parsePageParam(sp.page));
  if (!landing) notFound();
  const { category, posts, otherCategories } = landing;
  const lower = category.name.toLowerCase();

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={blogArchiveTrail(category.name)} />
      {posts.page === 1 && posts.items.length > 0 && (
        <JsonLd data={itemListJsonLd(`${category.name} articles`, posts.items.map((p) => ({ name: p.title, path: postPath(p.slug), image: p.coverImageUrl })), { origin: siteOrigin() })} />
      )}
      <PostArchive
        title={`${category.name} articles`}
        posts={posts}
        basePath={blogCategoryPath(category.slug)}
        label={`${category.name} article pages`}
        intro={
          <>
            {category.intro ? <Markdown content={category.intro} /> : <p>Guides, tutorials and practical advice on {lower} from the instructors at {settings.brand.name}.</p>}
            {settings.features.courses && (
              <p className="mt-3">
                <Link href={categoryPath(category.slug)} className="font-medium text-accent hover:underline">
                  Browse {lower} courses
                </Link>
              </p>
            )}
          </>
        }
      >
        {otherCategories.length > 0 && (
          <section aria-labelledby="blog-other-categories" className="mt-12">
            <h2 id="blog-other-categories" className="mb-3 text-xl font-semibold tracking-tight text-ink">
              More topics on the blog
            </h2>
            <ChipLinks label="Other blog categories" items={otherCategories.map((c) => ({ href: blogCategoryPath(c.slug), label: c.name, count: c.postCount }))} />
          </section>
        )}
      </PostArchive>
    </div>
  );
}

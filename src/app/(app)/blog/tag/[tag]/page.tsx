import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/lib/db/store";
import { getBlogTagLanding, publishDuePosts } from "@/lib/data/blog";
import { blogArchiveTrail } from "@/lib/seo/breadcrumbs";
import { blogTagPath, postPath } from "@/lib/seo/content-index";
import { itemListJsonLd } from "@/lib/seo/jsonld";
import { parsePageParam } from "@/lib/seo/landing";
import { listingIndexing, notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { decodeSegment, siteOrigin } from "@/lib/seo/site";
import { PostArchive } from "@/components/blog/post-archive";
import { ChipLinks } from "@/components/marketing/chip-links";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/blog/tag/[tag]">): Promise<Metadata> {
  const [{ tag }, sp, settings, t, locale] = await Promise.all([props.params, props.searchParams, getSettings(), getT("public"), getLocale()]);
  const page = parsePageParam(sp.page);
  const landing = settings.seo.blogEnabled ? await getBlogTagLanding(decodeSegment(tag) ?? "", page) : null;
  if (!landing) return notFoundMetadata(t("topics.notFound"));
  const { label, posts, slug } = landing;
  const titles = posts.items.slice(0, 3).map((p) => p.title);
  return pageMetadata(
    {
      title: t("categories.articles", { category: label }),
      description: [t("blog.tag.metaDescription", { count: posts.total, topic: label.toLowerCase(), brand: settings.brand.name, titles: titles.join("; ") })],
      path: blogTagPath(slug),
      locale,
      ...listingIndexing({ page }),
      keywords: [label],
    },
    settings,
  );
}

export default async function BlogTagPage(props: PageProps<"/blog/tag/[tag]">) {
  const [{ tag: rawTag }, sp, settings, t] = await Promise.all([props.params, props.searchParams, getSettings(), getT("public")]);
  const tag = decodeSegment(rawTag);
  if (!settings.seo.blogEnabled || !tag) notFound();
  await publishDuePosts();
  const landing = await getBlogTagLanding(tag, parsePageParam(sp.page));
  if (!landing) notFound();
  const { label, posts, relatedTags, slug } = landing;

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={blogArchiveTrail(label)} />
      {posts.page === 1 && posts.items.length > 0 && (
        <JsonLd data={itemListJsonLd(`${label} articles`, posts.items.map((p) => ({ name: p.title, path: postPath(p.slug), image: p.coverImageUrl })), { origin: siteOrigin() })} />
      )}
      <PostArchive
        title={t("categories.articles", { category: label })}
        posts={posts}
        basePath={blogTagPath(slug)}
        label={t("blog.archive.pagesLabel", { name: label })}
        intro={<p>{t("blog.tag.intro", { brand: settings.brand.name, topic: label.toLowerCase() })}</p>}
      >
        {relatedTags.length > 0 && (
          <section aria-labelledby="blog-related-tags" className="mt-12">
            <h2 id="blog-related-tags" className="mb-3 text-xl font-semibold tracking-tight text-ink">
              {t("topics.related")}
            </h2>
            <ChipLinks label={t("blog.tag.relatedLabel")} items={relatedTags.map((tag) => ({ href: blogTagPath(tag.slug), label: tag.label, count: tag.count }))} />
          </section>
        )}
      </PostArchive>
    </div>
  );
}

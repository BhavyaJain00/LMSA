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

export async function generateMetadata(props: PageProps<"/blog/tag/[tag]">): Promise<Metadata> {
  const [{ tag }, sp, settings] = await Promise.all([props.params, props.searchParams, getSettings()]);
  const page = parsePageParam(sp.page);
  const landing = settings.seo.blogEnabled ? await getBlogTagLanding(decodeSegment(tag) ?? "", page) : null;
  if (!landing) return notFoundMetadata("Topic not found");
  const { label, posts, slug } = landing;
  const titles = posts.items.slice(0, 3).map((p) => p.title);
  return pageMetadata(
    {
      title: `${label} articles`,
      description: [`Read ${posts.total === 1 ? "our article" : `${posts.total} articles`} about ${label.toLowerCase()} on the ${settings.brand.name} blog: ${titles.join("; ")}.`],
      path: blogTagPath(slug),
      ...listingIndexing({ page }),
      keywords: [label],
    },
    settings,
  );
}

export default async function BlogTagPage(props: PageProps<"/blog/tag/[tag]">) {
  const [{ tag: rawTag }, sp, settings] = await Promise.all([props.params, props.searchParams, getSettings()]);
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
        title={`${label} articles`}
        posts={posts}
        basePath={blogTagPath(slug)}
        label={`${label} article pages`}
        intro={<p>Every article on the {settings.brand.name} blog about {label.toLowerCase()}, newest first.</p>}
      >
        {relatedTags.length > 0 && (
          <section aria-labelledby="blog-related-tags" className="mt-12">
            <h2 id="blog-related-tags" className="mb-3 text-xl font-semibold tracking-tight text-ink">
              Related topics
            </h2>
            <ChipLinks label="Related blog topics" items={relatedTags.map((t) => ({ href: blogTagPath(t.slug), label: t.label, count: t.count }))} />
          </section>
        )}
      </PostArchive>
    </div>
  );
}

import { OG_CONTENT_TYPE, renderOgCard, renderSiteOgCard } from "@/components/seo/og-card";
import { getSettings } from "@/lib/db/store";
import { getPostBySlug } from "@/lib/data/blog";
import { OG_IMAGE_SIZE } from "@/lib/seo/metadata";
import { decodeSegment } from "@/lib/seo/site";
import { readingTimeLabel } from "@/lib/seo/text";

export const alt = "Article: title, summary, author and reading time";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function PostOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const settings = await getSettings();
  const detail = settings.seo.blogEnabled ? await getPostBySlug(decodeSegment(slug) ?? "") : null;
  // Drafts and scheduled posts never leak through their share image.
  if (!detail?.isPublic) return renderSiteOgCard();
  const { post, author, categories } = detail;
  return renderOgCard({
    eyebrow: categories[0] ? `Blog · ${categories[0].name}` : "Blog",
    title: post.title,
    summary: post.excerpt,
    facts: [author ? `By ${author.name}` : "", readingTimeLabel(post.readingTimeSeconds)].filter(Boolean),
  });
}

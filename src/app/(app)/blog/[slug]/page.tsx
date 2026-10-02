import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { authorProfilePath, canEditPost, getPostBySlug, getRelatedPosts, publishDuePosts, recordPostView } from "@/lib/data/blog";
import { catalogIsPublic, getPublicCourseSummaries, getSeoContext } from "@/lib/data/seo";
import { Markdown, extractHeadings } from "@/lib/markdown";
import { buildToc, isLikelyBot, postDocumentTitle, stripCodeFences } from "@/lib/seo/blog";
import { postTrail } from "@/lib/seo/breadcrumbs";
import { blogCategoryPath, blogTagPath, postPath } from "@/lib/seo/content-index";
import { blogPostingJsonLd, faqPageJsonLd } from "@/lib/seo/jsonld";
import { notFoundMetadata, pageMetadata, privatePageMetadata } from "@/lib/seo/metadata";
import { absoluteUrl, decodeSegment, siteOrigin } from "@/lib/seo/site";
import { metaDescription, tagSlug, wordCount } from "@/lib/seo/text";
import { AuthorBox } from "@/components/blog/author-box";
import { PostFaq } from "@/components/blog/post-faq";
import { PostToc } from "@/components/blog/post-toc";
import { RelatedCourseCta } from "@/components/blog/related-course-cta";
import { ShareBar } from "@/components/blog/share-bar";
import { ArticleTeasers } from "@/components/marketing/article-teasers";
import { LeadForm } from "@/components/marketing/lead-form";
import { privacyPolicyHref } from "@/lib/seo/lead-capture";
import { ChipLinks } from "@/components/marketing/chip-links";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { getFormatter, getLocale, getT } from "@/i18n/server";

async function loadPost(rawSlug: string) {
  const slug = decodeSegment(rawSlug);
  return slug ? getPostBySlug(slug) : null;
}

export async function generateMetadata(props: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const [{ slug }, settings, t, locale] = await Promise.all([props.params, getSettings(), getT("public"), getLocale()]);
  const detail = await loadPost(slug);
  if (!detail) return notFoundMetadata(t("blog.post.notFound"));
  const { post, author, categories } = detail;
  if (!detail.isPublic || !settings.seo.blogEnabled) {
    // Editors preview drafts here; nobody else learns the article exists.
    const user = await getCurrentUser();
    return canEditPost(user, post) ? privatePageMetadata(t("blog.post.previewTitle", { title: post.title })) : notFoundMetadata(t("blog.post.notFound"));
  }
  return pageMetadata(
    {
      title: postDocumentTitle(post),
      description: post.seoDescription?.trim() || [post.excerpt, post.content],
      path: postPath(post.slug),
      locale,
      canonicalOverride: post.canonicalUrl?.trim() || undefined,
      type: "article",
      generatedImage: true,
      noindex: !!post.noindex,
      follow: true,
      keywords: [post.focusKeyword ?? "", ...post.tags].filter(Boolean),
      article: {
        publishedTime: post.publishedAt,
        modifiedTime: post.updatedAt,
        authors: author ? [author.name] : undefined,
        section: categories[0]?.name,
        tags: post.tags,
      },
    },
    settings,
  );
}

export default async function BlogPostPage(props: PageProps<"/blog/[slug]">) {
  const [{ slug: rawSlug }, settings, user, t, f] = await Promise.all([props.params, getSettings(), getCurrentUser(), getT("public"), getFormatter()]);
  await publishDuePosts();
  const detail = await loadPost(rawSlug);
  if (!detail) notFound();
  const { post, author, categories, status } = detail;
  const editor = canEditPost(user, post);
  const live = detail.isPublic && settings.seo.blogEnabled;
  if (!live && !editor) notFound();

  const path = postPath(post.slug);
  const url = absoluteUrl(path, siteOrigin())!;
  const showCourses = settings.features.courses && post.relatedCourseIds.length > 0 && (catalogIsPublic(settings) || !!user);
  const [related, courseList, profileHref, ctx] = await Promise.all([
    getRelatedPosts(post, 3),
    showCourses ? getPublicCourseSummaries() : Promise.resolve([]),
    author ? authorProfilePath(author.id) : Promise.resolve(null),
    getSeoContext(),
  ]);
  const byId = new Map(courseList.map((c) => [c.id, c]));
  const courses = post.relatedCourseIds.map((id) => byId.get(id)).filter((c) => !!c);
  const toc = buildToc(extractHeadings(stripCodeFences(post.content)));
  const faq = post.faq ?? [];
  const category = categories[0];

  if (live && !editor) {
    const ua = (await headers()).get("user-agent");
    if (!isLikelyBot(ua)) after(() => recordPostView(post.id));
  }

  const jsonLd = live
    ? [
        blogPostingJsonLd(
          {
            headline: post.title,
            description: post.seoDescription?.trim() || metaDescription(post.excerpt, post.content),
            path,
            image: post.coverImageUrl || `${path}/opengraph-image`,
            author: { name: author?.name ?? settings.brand.name, url: profileHref ?? undefined, image: author?.avatarUrl },
            datePublished: post.publishedAt ?? post.createdAt,
            dateModified: post.updatedAt,
            section: category?.name,
            keywords: [post.focusKeyword ?? "", ...post.tags].filter(Boolean),
            wordCount: wordCount(post.content),
          },
          ctx,
        ),
        faqPageJsonLd(faq),
      ].filter((d) => !!d)
    : [];

  const updated = post.publishedAt && Date.parse(post.updatedAt) - Date.parse(post.publishedAt) > 86_400_000;

  return (
    <div className="animate-fade-in pb-6">
      <Breadcrumbs items={postTrail(post, category)} />
      {jsonLd.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}

      {(!live || editor) && (
        <div
          role={live ? undefined : "status"}
          className={
            live
              ? "mb-5 flex flex-wrap items-center gap-3 justify-between rounded-card border border-border bg-surface-1 px-4 py-3 text-sm"
              : "mb-5 flex flex-wrap items-center gap-3 justify-between rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
          }
        >
          <p className="flex items-start gap-2 text-ink">
            <Icon.Eye className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span>
              {live
                ? post.noindex
                  ? t("blog.post.publishedHidden", { count: post.views })
                  : t("blog.post.published", { count: post.views })
                : !settings.seo.blogEnabled
                  ? t("blog.post.previewBlogOff")
                  : status === "scheduled"
                    ? t("blog.post.previewScheduled", { date: f.dateTime(post.publishedAt) })
                    : t("blog.post.previewDraft")}
            </span>
          </p>
          <ButtonLink href={`/admin/blog/${post.id}`} size="sm" variant="outline" leftIcon={<Icon.Edit className="size-4" />}>
            {t("blog.post.edit")}
          </ButtonLink>
        </div>
      )}

      <div className={toc.length ? "lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-12" : undefined}>
        <article className="mx-auto min-w-0 max-w-3xl">
          <header>
            {categories.length > 0 && (
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium">
                {categories.map((c) => (
                  <Link key={c.id} href={blogCategoryPath(c.slug)} className="text-accent hover:underline">
                    {c.name}
                  </Link>
                ))}
              </p>
            )}
            <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">{post.title}</h1>
            {post.excerpt && <p className="mt-3 text-lg leading-relaxed text-ink-muted">{post.excerpt}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              {author && <Avatar name={author.name} src={author.avatarUrl} size="md" />}
              <div className="min-w-0">
                {author && (
                  <p className="font-medium text-ink">
                    {profileHref ? (
                      <Link href={profileHref} className="hover:text-accent hover:underline">
                        {author.name}
                      </Link>
                    ) : (
                      author.name
                    )}
                  </p>
                )}
                <p className="flex flex-wrap items-center gap-x-2">
                  {post.publishedAt && <time dateTime={post.publishedAt}>{f.date(post.publishedAt)}</time>}
                  {updated && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t.rich("blog.post.updated", { date: f.date(post.updatedAt), time: (chunks) => <time dateTime={post.updatedAt}>{chunks}</time> })}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{t("blog.readingTime", { minutes: Math.max(1, Math.round(post.readingTimeSeconds / 60)) })}</span>
                </p>
              </div>
            </div>
          </header>

          {post.coverImageUrl && (
            <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-card border border-border bg-surface-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.coverImageUrl} alt="" loading="eager" fetchPriority="high" decoding="async" className="absolute inset-0 size-full object-cover" />
            </div>
          )}

          <div className="mt-6">
            <PostToc entries={toc} variant="inline" />
          </div>

          <Markdown content={post.content} className="mt-6 text-base [&_h2]:scroll-mt-24 [&_h3]:scroll-mt-24" />

          {post.tags.length > 0 && (
            <div className="mt-8">
              <h2 className="sr-only">{t("blog.post.topics")}</h2>
              <ChipLinks label={t("blog.post.topicsLabel")} items={post.tags.filter((tag) => tagSlug(tag)).map((tag) => ({ href: blogTagPath(tagSlug(tag)), label: tag }))} />
            </div>
          )}

          <div className="mt-6 border-t border-border pt-5">
            <ShareBar url={url} title={post.title} />
          </div>

          <div className="mt-10">
            <LeadForm
              source="blog"
              title={t("blog.post.leadTitle")}
              description={t("blog.post.leadDescription")}
              privacyHref={await privacyPolicyHref()}
            />
          </div>

          {courses.length > 0 && (
            <div className="mt-10">
              <RelatedCourseCta courses={courses} />
            </div>
          )}

          {faq.length > 0 && (
            <div className="mt-10">
              <PostFaq items={faq} />
            </div>
          )}

          {author && (
            <div className="mt-10">
              <AuthorBox author={author} profileHref={profileHref} />
            </div>
          )}
        </article>

        {toc.length > 0 && (
          <aside className="hidden lg:block">
            <PostToc entries={toc} variant="sidebar" />
          </aside>
        )}
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related-posts-heading" className="mt-14">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="related-posts-heading" className="text-2xl font-semibold tracking-tight text-ink">
              {t("blog.post.keepReading")}
            </h2>
            <Link href="/blog" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              {t("blog.allArticles")}
              <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          </div>
          <ArticleTeasers posts={related} />
        </section>
      )}
    </div>
  );
}

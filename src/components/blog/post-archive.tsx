import type { ReactNode } from "react";
import type { PostPage } from "@/lib/data/blog";
import { landingHref } from "@/lib/seo/landing";
import { PageLinks } from "@/components/gamification/page-links";
import { ArticleTeasers } from "@/components/marketing/article-teasers";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

/**
 * Body of a blog archive (category or topic): heading, intro, the article
 * grid with pagination (page 1 is the bare canonical URL) and an optional
 * block of related links underneath. Server Component.
 */
export async function PostArchive({
  title,
  intro,
  posts,
  basePath,
  label,
  children,
}: {
  title: string;
  intro: ReactNode;
  posts: PostPage;
  basePath: string;
  /** Accessible name of the pagination, e.g. "JavaScript article pages". */
  label: string;
  /** Related links rendered below the list (other categories, related topics). */
  children?: ReactNode;
}) {
  const t = await getT("public");
  return (
    <>
      <header className="mb-8 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {posts.pages > 1 ? t("blog.archive.countPaged", { count: posts.total, page: posts.page, pages: posts.pages }) : t("blog.archive.count", { count: posts.total })}
        </p>
        <div className="mt-4 text-base leading-7 text-ink-muted">{intro}</div>
      </header>
      {posts.items.length ? (
        <ArticleTeasers posts={posts.items} />
      ) : (
        <EmptyState
          icon={<Icon.FileText />}
          title={t("blog.archive.emptyTitle")}
          description={t("blog.archive.emptyDescription")}
          action={<ButtonLink href="/blog">{t("blog.allArticles")}</ButtonLink>}
        />
      )}
      <PageLinks className="mt-8" page={posts.page} pageCount={posts.pages} hrefFor={(page) => landingHref(basePath, { page })} label={label} />
      {children}
    </>
  );
}

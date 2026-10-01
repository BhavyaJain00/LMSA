import type { ReactNode } from "react";
import type { PostPage } from "@/lib/data/blog";
import { landingHref } from "@/lib/seo/landing";
import { PageLinks } from "@/components/gamification/page-links";
import { ArticleTeasers } from "@/components/marketing/article-teasers";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { pluralize } from "@/lib/utils";

/**
 * Body of a blog archive (category or topic): heading, intro, the article
 * grid with pagination (page 1 is the bare canonical URL) and an optional
 * block of related links underneath. Server Component.
 */
export function PostArchive({
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
  return (
    <>
      <header className="mb-8 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {pluralize(posts.total, "article")}
          {posts.pages > 1 && ` · page ${posts.page} of ${posts.pages}`}
        </p>
        <div className="mt-4 text-base leading-7 text-ink-muted">{intro}</div>
      </header>
      {posts.items.length ? (
        <ArticleTeasers posts={posts.items} />
      ) : (
        <EmptyState
          icon={<Icon.FileText />}
          title="No articles here yet"
          description="New articles will appear here as soon as they are published."
          action={<ButtonLink href="/blog">All articles</ButtonLink>}
        />
      )}
      <PageLinks className="mt-8" page={posts.page} pageCount={posts.pages} hrefFor={(page) => landingHref(basePath, { page })} label={label} />
      {children}
    </>
  );
}

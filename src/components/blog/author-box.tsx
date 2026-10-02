import Link from "next/link";
import type { PostAuthor } from "@/lib/data/blog";
import { Markdown } from "@/lib/markdown";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";

/**
 * "About the author" block under an article: avatar, name (linked to the
 * teaching profile or public profile), headline and bio. A visible author
 * with credentials is part of what search engines look for in helpful
 * content. Server Component.
 */
export async function AuthorBox({ author, profileHref }: { author: PostAuthor; profileHref: string | null }) {
  const t = await getT("public");
  return (
    <section aria-labelledby="author-heading" className="rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6">
      <h2 id="author-heading" className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {t("blog.author.title")}
      </h2>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar name={author.name} src={author.avatarUrl} size="xl" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-ink">
            {profileHref ? (
              <Link href={profileHref} className="hover:text-accent hover:underline">
                {author.name}
              </Link>
            ) : (
              author.name
            )}
          </p>
          {author.headline && <p className="text-sm text-ink-muted">{author.headline}</p>}
          {author.bio && <Markdown content={author.bio} className="mt-3 text-sm" />}
          {profileHref && (
            <Link href={profileHref} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              {t("course.instructors.viewProfile")}
              <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

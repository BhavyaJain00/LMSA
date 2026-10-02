import Link from "next/link";
import type { PostListItem } from "@/lib/data/blog";
import { postPath } from "@/lib/seo/content-index";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";

/**
 * Compact article cards for "From the blog" blocks on course, category,
 * topic and instructor pages. The cover sits in a fixed 16:9 box so the
 * layout never shifts while it loads. Server Component.
 */
export async function ArticleTeasers({ posts, headingLevel = "h3", className }: { posts: PostListItem[]; headingLevel?: "h3" | "h4"; className?: string }) {
  if (!posts.length) return null;
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  const Heading = headingLevel;
  return (
    <ul className={cn("grid gap-5 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {posts.map((post) => (
        <li key={post.id} className="min-w-0">
          <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface-1 shadow-card transition-shadow hover:shadow-pop focus-within:ring-2 focus-within:ring-accent/60">
            <div className="relative aspect-video w-full shrink-0 overflow-hidden border-b border-border bg-surface-3">
              {post.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.coverImageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-ink-faint" aria-hidden="true">
                  <Icon.FileText className="size-8" />
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col p-4">
              {post.categories[0] && <p className="text-xs font-medium text-accent">{post.categories[0].name}</p>}
              <Heading className="mt-1 line-clamp-2 text-base font-semibold leading-snug tracking-tight text-ink">
                <Link href={postPath(post.slug)} className="outline-none before:absolute before:inset-0 before:content-['']">
                  {post.title}
                </Link>
              </Heading>
              {post.excerpt && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">{post.excerpt}</p>}
              <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-3 text-xs text-ink-muted">
                {post.author && <span className="truncate">{post.author.name}</span>}
                {post.author && post.publishedAt && <span aria-hidden="true">·</span>}
                {post.publishedAt && <time dateTime={post.publishedAt}>{f.date(post.publishedAt)}</time>}
                <span aria-hidden="true">·</span>
                <span>{t("blog.readingTime", { minutes: Math.max(1, Math.round(post.readingTimeSeconds / 60)) })}</span>
              </p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

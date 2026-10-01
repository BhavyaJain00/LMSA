import Link from "next/link";
import type { PostListItem } from "@/lib/data/blog";
import { postPath } from "@/lib/seo/content-index";
import { readingTimeLabel } from "@/lib/seo/text";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { formatDate } from "@/lib/utils";

/**
 * The newest article at the top of /blog: a wide card with the cover (the
 * page's LCP image, so it loads eagerly with high priority inside a fixed
 * 16:9 box), category, title, excerpt and byline. Server Component.
 */
export function FeaturedPost({ post }: { post: PostListItem }) {
  return (
    <article className="group relative grid overflow-hidden rounded-card border border-border bg-surface-1 shadow-card transition-shadow hover:shadow-pop focus-within:ring-2 focus-within:ring-accent/60 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="relative aspect-video w-full overflow-hidden bg-surface-3 md:aspect-auto md:min-h-72">
        {post.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverImageUrl} alt="" loading="eager" fetchPriority="high" decoding="async" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-linear-to-br from-accent/15 to-surface-3 text-accent" aria-hidden="true">
            <Icon.FileText className="size-12" />
          </div>
        )}
      </div>
      <div className="flex flex-col p-5 sm:p-7">
        <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">Featured</span>
          {post.categories[0] && <span className="text-ink-muted">{post.categories[0].name}</span>}
        </p>
        <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
          <Link href={postPath(post.slug)} className="outline-none before:absolute before:inset-0 before:content-['']">
            {post.title}
          </Link>
        </h2>
        {post.excerpt && <p className="mt-3 line-clamp-4 text-base leading-relaxed text-ink-muted">{post.excerpt}</p>}
        <div className="mt-auto flex items-center gap-3 pt-5 text-sm text-ink-muted">
          {post.author && <Avatar name={post.author.name} src={post.author.avatarUrl} size="sm" />}
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {post.author && <span className="truncate font-medium text-ink">{post.author.name}</span>}
            {post.publishedAt && <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>}
            <span aria-hidden="true">·</span>
            <span>{readingTimeLabel(post.readingTimeSeconds)}</span>
          </p>
        </div>
      </div>
    </article>
  );
}

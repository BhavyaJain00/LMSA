import type { Database } from "@/lib/types";
import { coursePath, postPath } from "./content-index";
import type { RssChannel, RssItem } from "./rss";
import { absoluteUrl } from "./site";
import { publicCourses } from "./sitemap";
import { metaDescription } from "./text";
import { isPostPublic } from "./visibility";

/**
 * RSS channels of the site (pure): newly published courses (`/rss.xml`) and
 * blog posts (`/blog/rss.xml`). Both list only what an anonymous visitor can
 * open, newest first, and are empty while the whole site is set to noindex.
 */

/** Feed readers only need the recent items; older ones stay reachable through the sitemap. */
export const FEED_ITEM_LIMIT = 30;

type CourseFeedDb = Pick<Database, "courses" | "users" | "categories" | "settings">;
type BlogFeedDb = Pick<Database, "blogPosts" | "users" | "categories" | "settings">;

function uniqueLabels(labels: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const clean = label?.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

/** New courses, most recently published first. */
export function courseFeed(db: CourseFeedDb, origin: string, now: number = Date.now()): RssChannel {
  const { settings } = db;
  const users = new Map(db.users.map((u) => [u.id, u]));
  const categories = new Map(db.categories.map((c) => [c.id, c]));
  const items: RssItem[] = settings.seo.noindexSite
    ? []
    : publicCourses(db, now)
        .slice(0, FEED_ITEM_LIMIT)
        .map((course) => ({
          title: course.title,
          link: absoluteUrl(coursePath(course.slug), origin)!,
          description: metaDescription(course.shortIntroduction, course.description) || course.title,
          pubDate: course.publishedOn ?? course.createdAt,
          author:
            course.instructorIds
              .map((id) => users.get(id)?.name)
              .filter(Boolean)
              .join(", ") || undefined,
          categories: uniqueLabels([course.categoryId ? categories.get(course.categoryId)?.name : undefined, ...course.tags]),
          image: absoluteUrl(course.imageUrl, origin),
        }));
  return {
    title: `New courses · ${settings.brand.name}`,
    link: absoluteUrl("/courses", origin)!,
    feedUrl: `${origin}/rss.xml`,
    description: metaDescription(`The latest courses published on ${settings.brand.name}.`, settings.seo.defaultDescription, settings.brand.metaDescription),
    items,
  };
}

/** Blog posts, most recently published first (noindexed posts are left out). */
export function blogFeed(db: BlogFeedDb, origin: string, now: number = Date.now()): RssChannel {
  const { settings } = db;
  const users = new Map(db.users.map((u) => [u.id, u]));
  const categories = new Map(db.categories.map((c) => [c.id, c]));
  const items: RssItem[] =
    settings.seo.noindexSite || !settings.seo.blogEnabled
      ? []
      : db.blogPosts
          .filter((post) => isPostPublic(post, now) && !post.noindex)
          .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt))
          .slice(0, FEED_ITEM_LIMIT)
          .map((post) => ({
            title: post.title,
            link: absoluteUrl(postPath(post.slug), origin)!,
            description: metaDescription(post.excerpt, post.content) || post.title,
            pubDate: post.publishedAt ?? post.createdAt,
            author: users.get(post.authorId)?.name,
            categories: uniqueLabels([...post.categoryIds.map((id) => categories.get(id)?.name), ...post.tags]),
            image: absoluteUrl(post.coverImageUrl, origin),
          }));
  return {
    title: `Blog · ${settings.brand.name}`,
    link: absoluteUrl("/blog", origin)!,
    feedUrl: `${origin}/blog/rss.xml`,
    description: metaDescription(`Articles, guides and news from ${settings.brand.name}.`, settings.seo.defaultDescription, settings.brand.metaDescription),
    items,
  };
}

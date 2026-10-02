import Link from "next/link";
import type { Course } from "@/lib/types";
import { getCourseArticles } from "@/lib/data/seo";
import { Icon } from "@/components/ui/icons";
import { getT } from "@/i18n/server";
import { ArticleTeasers } from "./article-teasers";

/**
 * "From the blog" block of a public course page: the articles that recommend
 * the course, topped up with recent ones from its category. Renders nothing
 * while the blog is off or has no matching article. Server Component.
 */
export async function CourseArticles({ course }: { course: Pick<Course, "id" | "categoryId"> }) {
  const [posts, t] = await Promise.all([getCourseArticles(course), getT("public")]);
  if (!posts.length) return null;
  return (
    <section aria-labelledby="course-articles-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="course-articles-heading" className="text-2xl font-semibold tracking-tight text-ink">
          {t("blog.fromTheBlog")}
        </h2>
        <Link href="/blog" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          {t("blog.allArticles")}
          <Icon.ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
      <ArticleTeasers posts={posts} />
    </section>
  );
}

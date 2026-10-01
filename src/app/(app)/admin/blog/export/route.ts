import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { canWritePosts, getAdminPosts } from "@/lib/data/blog";
import { parseAdminPostFilter } from "@/lib/seo/blog";
import { absoluteUrl } from "@/lib/seo/site";
import { postPath } from "@/lib/seo/content-index";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { toDateKey } from "@/lib/utils";

/**
 * GET /admin/blog/export — the articles matching the list's filters (`status`,
 * `q`, `author`, `category`) as CSV: status, dates, author, categories, tags,
 * focus keyword, indexing and views. Writers export their own articles,
 * moderators every article.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/admin/blog")}`, req.url));
  if (!canWritePosts(user)) return new NextResponse("You don't have permission to export blog articles.", { status: 403 });

  const params = req.nextUrl.searchParams;
  const { rows } = await getAdminPosts(user, {
    status: parseAdminPostFilter(params.get("status") ?? undefined),
    search: params.get("q")?.slice(0, 200) ?? "",
    authorId: params.get("author") || undefined,
    categoryId: params.get("category") || undefined,
    pageSize: Number.MAX_SAFE_INTEGER,
  });
  const csv = toCsv([
    ["Title", "URL", "Status", "Published / scheduled", "Updated", "Author", "Categories", "Tags", "Focus keyword", "Indexed", "Reading time (min)", "Views"],
    ...rows.map((r) => [
      r.title,
      absoluteUrl(postPath(r.slug)) ?? postPath(r.slug),
      r.status,
      r.publishedAt ?? "",
      r.updatedAt,
      r.author?.name ?? "",
      r.categories.map((c) => c.name).join("; "),
      r.tags.join("; "),
      r.focusKeyword ?? "",
      r.noindex ? "no" : "yes",
      String(Math.max(1, Math.round(r.readingTimeSeconds / 60))),
      String(r.views),
    ]),
  ]);
  await audit(user, "blog.export", undefined, { rows: rows.length });

  // BOM so spreadsheet apps detect UTF-8.
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="blog-articles-${toDateKey()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

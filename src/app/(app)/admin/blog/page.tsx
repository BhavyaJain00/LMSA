import Link from "next/link";
import { isAdmin, isModerator, requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getAdminPosts, getPostEditorOptions, publishDuePosts } from "@/lib/data/blog";
import { parseAdminPostFilter, type AdminPostFilter } from "@/lib/seo/blog";
import { parsePageParam } from "@/lib/seo/landing";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { PostsTable } from "@/components/blog/admin/posts-table";
import { PageLinks } from "@/components/gamification/page-links";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Blog" };

const BASE = "/admin/blog";

interface ListState {
  status: AdminPostFilter;
  q: string;
  author: string;
  category: string;
  page?: number;
}

function first(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, 200);
}

function query(state: Omit<ListState, "page"> & { page?: number }): string {
  const params = new URLSearchParams();
  if (state.status !== "all") params.set("status", state.status);
  if (state.q) params.set("q", state.q);
  if (state.author) params.set("author", state.author);
  if (state.category) params.set("category", state.category);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  return params.toString();
}

function hrefFor(state: ListState): string {
  const q = query(state);
  return q ? `${BASE}?${q}` : BASE;
}

export default async function AdminBlogPage(props: PageProps<"/admin/blog">) {
  const viewer = await requireRole(["course_creator", "moderator"], BASE);
  const [sp, settings] = await Promise.all([props.searchParams, getSettings()]);
  await publishDuePosts();

  const state: ListState = { status: parseAdminPostFilter(sp.status), q: first(sp.q), author: first(sp.author), category: first(sp.category) };
  const [result, { categories }] = await Promise.all([
    getAdminPosts(viewer, { status: state.status, search: state.q, authorId: state.author || undefined, categoryId: state.category || undefined, page: parsePageParam(sp.page) }),
    getPostEditorOptions(viewer),
  ]);
  const { rows, total, page, pages, counts, authors } = result;
  const moderator = isModerator(viewer);
  const filtered = !!state.q || !!state.author || !!state.category || state.status !== "all";
  const exportQuery = query({ ...state, page: undefined });

  const tabs: { value: AdminPostFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "published", label: "Published" },
    { value: "scheduled", label: "Scheduled" },
    { value: "draft", label: "Drafts" },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Blog" }]} />}
        title="Blog"
        description={`${moderator ? "Every article on the blog." : "Your articles."} Write, schedule and optimise articles that bring learners in from search engines and lead them to your courses.`}
        actions={
          <>
            {settings.seo.blogEnabled && (
              <ButtonLink href="/blog" variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
                View blog
              </ButtonLink>
            )}
            {counts.all > 0 && (
              <a href={`${BASE}/export${exportQuery ? `?${exportQuery}` : ""}`} className={buttonClasses({ variant: "outline" })} download>
                <Icon.Download className="size-4" aria-hidden="true" />
                Export CSV
              </a>
            )}
            <ButtonLink href="/admin/blog/new" leftIcon={<Icon.Plus className="size-4" />}>
              New article
            </ButtonLink>
          </>
        }
      />

      {!settings.seo.blogEnabled && (
        <p className="mb-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            The blog is switched off, so articles are not public yet — editors can still write and preview them.
            {isAdmin(viewer) ? (
              <>
                {" "}
                <Link href="/admin/settings/seo" className="font-medium text-accent hover:underline">
                  Turn it on in SEO settings
                </Link>
                .
              </>
            ) : (
              " An administrator can turn it on in the SEO settings."
            )}
          </span>
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <nav aria-label="Filter articles by status" className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.value}
              href={hrefFor({ ...state, status: tab.value })}
              aria-current={state.status === tab.value ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                state.status === tab.value ? "bg-ink text-surface-1" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {tab.label}
              <span className={cn("rounded-full px-1.5 text-[11px]", state.status === tab.value ? "bg-surface-1/20" : "bg-surface-3")}>{counts[tab.value]}</span>
            </Link>
          ))}
        </nav>
        <form action={BASE} method="get" role="search" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {state.status !== "all" && <input type="hidden" name="status" value={state.status} />}
          <Input type="search" name="q" defaultValue={state.q} placeholder="Title, slug, tag or keyword" aria-label="Search articles" leftAddon={<Icon.Search className="size-4" />} className="sm:w-60" />
          {categories.length > 0 && (
            <Select name="category" defaultValue={state.category} aria-label="Category" className="sm:w-44">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {moderator && authors.length > 1 && (
            <Select name="author" defaultValue={state.author} aria-label="Author" className="sm:w-44">
              <option value="">All authors</option>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
          <button type="submit" className={buttonClasses({ variant: "outline" })}>
            Filter
          </button>
        </form>
      </div>

      <PostsTable
        showAuthor={moderator}
        total={total}
        filtered={filtered}
        clearHref={BASE}
        rows={rows.map((r) => ({
          id: r.id,
          title: r.title,
          slug: r.slug,
          status: r.status,
          dateLabel:
            r.status === "scheduled" ? `Goes live ${formatDateTime(r.publishedAt)}` : r.status === "published" ? formatDate(r.publishedAt) : r.publishedAt ? `Planned ${formatDate(r.publishedAt)}` : "",
          updatedLabel: formatDate(r.updatedAt),
          author: r.author?.name ?? "—",
          categories: r.categories.map((c) => c.name).join(", "),
          views: r.views,
          focusKeyword: r.focusKeyword,
          noindex: r.noindex,
        }))}
      />

      <PageLinks className="mt-6" page={page} pageCount={pages} hrefFor={(p) => hrefFor({ ...state, page: p })} label="Article pages" />
    </div>
  );
}

import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { REDIRECTS_PAGE_SIZE, type RedirectFilter, listRedirects } from "@/lib/data/seo";
import { paginate, parsePageParam } from "@/lib/seo/landing";
import { siteOrigin } from "@/lib/seo/site";
import { PageLinks } from "@/components/gamification/page-links";
import { RedirectsManager } from "@/components/seo/admin/redirects-manager";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Redirects · SEO settings" };

const BASE = "/admin/settings/seo/redirects";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function hrefFor(state: { q: string; filter: RedirectFilter; page?: number }): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.filter !== "all") params.set("filter", state.filter);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  return query ? `${BASE}?${query}` : BASE;
}

export default async function SeoRedirectsPage(props: PageProps<"/admin/settings/seo/redirects">) {
  await requireRole(["admin"], BASE);
  const sp = await props.searchParams;
  const q = first(sp.q).slice(0, 200);
  const filter: RedirectFilter = first(sp.filter) === "broken" ? "broken" : "all";
  const { rows, total, broken } = await listRedirects({ search: q, filter });
  const paged = paginate(rows, parsePageParam(sp.page), REDIRECTS_PAGE_SIZE);
  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (filter !== "all") exportParams.set("filter", filter);
  const exportHref = `${BASE}/export${exportParams.size ? `?${exportParams}` : ""}`;

  const filters: { value: RedirectFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: total },
    { value: "broken", label: "Leading to a deleted page", count: broken },
  ];

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-ink-muted">
        When the URL of a course, batch, program, job, article or category changes, its old address keeps working: visitors and search engines are sent to the new one with a permanent (301) redirect, so links and rankings are not lost.
        These redirects are created for you. You can also add your own for retired pages or addresses from an older site.
      </p>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Filter redirects" className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {filters.map((f) => (
            <Link
              key={f.value}
              href={hrefFor({ q, filter: f.value })}
              aria-current={filter === f.value ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.value ? "bg-ink text-surface-1" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {f.label}
              <span className={cn("rounded-full px-1.5 text-[11px]", filter === f.value ? "bg-surface-1/20" : "bg-surface-3")}>{f.count}</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form action={BASE} method="get" role="search" className="flex gap-2">
            {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
            <Input type="search" name="q" defaultValue={q} placeholder="Search addresses" aria-label="Search redirects" leftAddon={<Icon.Search className="size-4" />} className="sm:w-56" />
            <button type="submit" className={buttonClasses({ variant: "outline" })}>
              Search
            </button>
          </form>
          {total > 0 && (
            <a href={exportHref} className={buttonClasses({ variant: "outline" })} download>
              <Icon.Download className="size-4" aria-hidden="true" />
              Export CSV
            </a>
          )}
        </div>
      </div>

      <RedirectsManager
        origin={siteOrigin()}
        rows={paged.items.map((r) => ({ id: r.id, fromPath: r.fromPath, toPath: r.toPath, status: r.status, added: formatDate(r.createdAt) }))}
        total={total}
        filtered={!!q || filter !== "all"}
        clearHref={BASE}
      />

      <PageLinks page={paged.page} pageCount={paged.pages} hrefFor={(page) => hrefFor({ q, filter, page })} label="Redirect pages" />
    </div>
  );
}

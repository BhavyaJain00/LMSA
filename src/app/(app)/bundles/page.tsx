import type { Metadata } from "next";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getBundleCatalog } from "@/lib/commerce/bundle-views";
import { listingIndexing, pageMetadata } from "@/lib/seo/metadata";
import { breadcrumbJsonLd, itemListJsonLd, seoContext } from "@/lib/seo/jsonld";
import { JsonLd } from "@/components/seo/json-ld";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { BundleCard } from "@/components/commerce/bundle-card";
import { BundleToolbar } from "@/components/commerce/bundle-toolbar";
import { Pager } from "@/components/commerce/pager";

type SearchParams = Awaited<PageProps<"/bundles">["searchParams"]>;

function readQuery(sp: SearchParams): { q: string; sort: string; page: number } {
  const page = Number(typeof sp.page === "string" ? sp.page : 1);
  return {
    q: typeof sp.q === "string" ? sp.q : "",
    sort: typeof sp.sort === "string" ? sp.sort : "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export async function generateMetadata(props: PageProps<"/bundles">): Promise<Metadata> {
  const [sp, settings] = await Promise.all([props.searchParams, getSettings()]);
  const query = readQuery(sp);
  const catalog = await getBundleCatalog(null, query);
  // Search, sort and page permutations all point at the one canonical list.
  const indexing = listingIndexing({ search: catalog.q, sort: catalog.sort === "newest" ? undefined : catalog.sort, page: catalog.page });
  return pageMetadata(
    {
      title: "Course bundles",
      description: [`Save with course bundles at ${settings.brand.name}: several courses for one price, unlocked together and yours to keep. Compare what each bundle includes and how much you save.`],
      path: "/bundles",
      noindex: !catalog.enabled || catalog.available === 0 || indexing.noindex,
      follow: indexing.follow,
    },
    settings,
  );
}

export default async function BundlesPage(props: PageProps<"/bundles">) {
  const [sp, user, settings] = await Promise.all([props.searchParams, getCurrentUser(), getSettings()]);
  const catalog = await getBundleCatalog(user, readQuery(sp));

  if (!catalog.enabled || catalog.available === 0) {
    const admin = isAdmin(user);
    return (
      <EmptyState
        icon={<Icon.Gift />}
        title="No bundles are on sale right now"
        description={
          admin
            ? catalog.enabled
              ? "Create a bundle and publish it to sell several courses for one price."
              : "Bundle sales are switched off. Turn them on and publish a bundle to open this page."
            : "Bundles group several courses at a lower price. None is available at the moment, but every course can be bought on its own."
        }
        action={
          admin ? (
            <ButtonLink href="/admin/settings/plans?tab=bundles" leftIcon={<Icon.Settings className="size-4" />}>
              Manage bundles
            </ButtonLink>
          ) : (
            <ButtonLink href="/courses" rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
              Browse courses
            </ButtonLink>
          )
        }
        className="my-10"
      />
    );
  }

  const ctx = seoContext(settings);
  const hrefFor = (page: number) => {
    const query = new URLSearchParams();
    if (catalog.q) query.set("q", catalog.q);
    if (catalog.sort !== "newest") query.set("sort", catalog.sort);
    if (page > 1) query.set("page", String(page));
    return query.size ? `/bundles?${query}` : "/bundles";
  };
  const best = Math.max(0, ...catalog.items.map((b) => b.savingsPercent));

  return (
    <div className="pb-12">
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Bundles", path: "/bundles" }], ctx),
          itemListJsonLd(
            "Course bundles",
            catalog.items.map((b) => ({ name: b.title, path: `/bundles/${b.slug}`, image: b.imageUrl })),
            ctx,
          ),
        ]}
      />

      <header className="mb-6">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          <Icon.Gift className="size-3.5" aria-hidden="true" />
          Learn more, pay less
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Course bundles</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted sm:text-base">
          Several courses for one price. Every course in a bundle unlocks at once and stays yours for good
          {best > 0 ? `, and you save up to ${best}% compared with buying them one by one.` : "."}
        </p>
      </header>

      <BundleToolbar q={catalog.q} sort={catalog.sort} />

      <p className="mt-4 text-sm text-ink-muted" role="status" aria-live="polite">
        {catalog.q
          ? `${catalog.total} of ${catalog.available} ${catalog.available === 1 ? "bundle" : "bundles"} match “${catalog.q}”`
          : `${catalog.total} ${catalog.total === 1 ? "bundle" : "bundles"}`}
      </p>

      {catalog.items.length === 0 ? (
        <EmptyState
          icon={<Icon.Search />}
          title="No bundles match your search"
          description="Try a different word, or a course title: bundles are also found by the courses inside them."
          action={
            <ButtonLink href="/bundles" variant="outline">
              Show all bundles
            </ButtonLink>
          }
          className="mt-4"
        />
      ) : (
        <ul className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Bundles">
          {catalog.items.map((bundle, i) => (
            <li key={bundle.id}>
              <BundleCard bundle={bundle} priority={i === 0 ? "high" : i < 3 ? "eager" : undefined} />
            </li>
          ))}
        </ul>
      )}

      <Pager className="mt-8 border-t border-border pt-4" page={catalog.page} pageCount={catalog.pageCount} hrefFor={hrefFor} label="Bundle pages" summary={`${catalog.total} ${catalog.total === 1 ? "bundle" : "bundles"}`} />
    </div>
  );
}

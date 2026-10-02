import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import {
  batchTabsFor,
  canCreateBatch,
  ensureBatchReminders,
  getBatchCategories,
  getBatchList,
  getBatchTabCounts,
  parseBatchTab,
} from "@/lib/data/batches";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { BatchCard } from "@/components/batches/batch-card";
import { ListFilters } from "@/components/batches/list-filters";
import type { BatchListTab } from "@/components/batches/types";
import { itemListJsonLd } from "@/lib/seo/jsonld";
import { listingIndexing, pageMetadata } from "@/lib/seo/metadata";
import { batchPath } from "@/lib/seo/content-index";
import { siteOrigin } from "@/lib/seo/site";
import { JsonLd } from "@/components/seo/json-ld";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/batches">): Promise<Metadata> {
  const [settings, sp, t, locale] = await Promise.all([getSettings(), props.searchParams, getT("public"), getLocale()]);
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const tab = str(sp.tab);
  // Tabs, search and filters canonicalise to the plain list of upcoming batches.
  const { noindex, follow } = listingIndexing({
    search: str(sp.search),
    filters: [str(sp.category), str(sp.certification), tab && tab !== "upcoming" ? tab : undefined],
  });
  return pageMetadata(
    {
      title: t("batches.meta.title"),
      description: [t("batches.meta.description", { brand: settings.brand.name })],
      path: "/batches",
      locale,
      noindex: noindex || !settings.features.batches,
      follow,
    },
    settings,
  );
}

/** Empty-state message keys per tab. */
const EMPTY_KEYS = {
  upcoming: { title: "batches.empty.upcomingTitle", description: "batches.empty.upcomingDescription" },
  live: { title: "batches.empty.liveTitle", description: "batches.empty.liveDescription" },
  archived: { title: "batches.empty.archivedTitle", description: "batches.empty.archivedDescription" },
  enrolled: { title: "batches.empty.enrolledTitle", description: "batches.empty.enrolledDescription" },
  unpublished: { title: "batches.empty.unpublishedTitle", description: "batches.empty.unpublishedDescription" },
} as const satisfies Record<BatchListTab, { title: string; description: string }>;

export default async function BatchesPage(props: PageProps<"/batches">) {
  const [user, settings, sp, t] = await Promise.all([getCurrentUser(), getSettings(), props.searchParams, getT("public")]);
  if (!settings.features.batches) notFound();
  if (!user && !settings.learning.allowGuestAccess) redirect("/login?next=%2Fbatches");
  // No scheduler: due batch-start and live-class reminders are sent when members load the page.
  if (user) await ensureBatchReminders(user.id).catch(() => 0);

  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const tab = parseBatchTab(str(sp.tab), user);
  const search = str(sp.search);
  const categories = await getBatchCategories(user);
  const categorySlug = str(sp.category);
  const category = categorySlug ? categories.find((c) => c.slug === categorySlug) : undefined;
  const certification = str(sp.certification) === "1";

  const [batches, counts] = await Promise.all([
    getBatchList(user, { tab, search, categoryId: category?.id, certification }),
    getBatchTabCounts(user),
  ]);
  const tabs = batchTabsFor(user);
  const filtered = !!(search || category || certification);
  const empty = EMPTY_KEYS[tab];

  const canonicalView = tab === "upcoming" && !filtered;
  const publicBatches = batches.filter((b) => b.published);

  return (
    <div className="animate-fade-in">
      {canonicalView && publicBatches.length > 0 && (
        <JsonLd data={itemListJsonLd("Upcoming batches", publicBatches.map((b) => ({ name: b.title, path: batchPath(b.slug), image: b.imageUrl })), { origin: siteOrigin() })} />
      )}
      <PageHeader
        title={t("batches.title")}
        description={t("batches.description")}
        actions={
          user && canCreateBatch(user) ? (
            <>
              <ButtonLink href="/admin/batches" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
                {t("batches.manage")}
              </ButtonLink>
              <ButtonLink href="/admin/batches/new" leftIcon={<Icon.Plus className="size-4" />}>
                {t("batches.new")}
              </ButtonLink>
            </>
          ) : null
        }
      />

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Tabs items={tabs.map((tab) => ({ value: tab.value, label: t(`batches.tabs.${tab.value}`), count: counts[tab.value] }))} className="lg:flex-1" />
        <ListFilters categories={categories.map((c) => ({ value: c.slug, label: c.name }))} certification certificationHint={t("batches.filters.certificationHint")} placeholder={t("batches.searchPlaceholder")} />
      </div>

      <p className="sr-only" role="status">
        {t("batches.resultsLoaded", { count: batches.length })}
      </p>

      {batches.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Icon.Search />}
            title={t("batches.empty.filteredTitle")}
            description={t("batches.empty.filteredDescription")}
            action={
              <ButtonLink href={tab === "upcoming" ? "/batches" : `/batches?tab=${tab}`} variant="outline">
                {t("batches.clearFilters")}
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon.Users />}
            title={t(empty.title)}
            description={t(empty.description)}
            action={
              tab === "unpublished" || (tab === "upcoming" && user && canCreateBatch(user)) ? (
                <ButtonLink href="/admin/batches/new" leftIcon={<Icon.Plus className="size-4" />}>
                  {t("batches.new")}
                </ButtonLink>
              ) : tab === "enrolled" ? (
                <ButtonLink href="/batches">{t("batches.browseUpcoming")}</ButtonLink>
              ) : null
            }
          />
        )
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {batches.map((b) => (
            <BatchCard key={b.id} batch={b} />
          ))}
        </div>
      )}
    </div>
  );
}

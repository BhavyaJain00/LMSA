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

export async function generateMetadata(props: PageProps<"/batches">): Promise<Metadata> {
  const [settings, sp] = await Promise.all([getSettings(), props.searchParams]);
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const tab = str(sp.tab);
  // Tabs, search and filters canonicalise to the plain list of upcoming batches.
  const { noindex, follow } = listingIndexing({
    search: str(sp.search),
    filters: [str(sp.category), str(sp.certification), tab && tab !== "upcoming" ? tab : undefined],
  });
  return pageMetadata(
    {
      title: "Live batches",
      description: [
        `Learn with a cohort on ${settings.brand.name}: scheduled live classes, a shared timetable, assessments and instructor support from start to finish.`,
      ],
      path: "/batches",
      noindex: noindex || !settings.features.batches,
      follow,
    },
    settings,
  );
}

const emptyCopy: Record<BatchListTab, { title: string; description: string }> = {
  upcoming: {
    title: "No Batches Found",
    description: "There are no batches currently. Keep an eye out, fresh learning experiences are on the way!",
  },
  live: {
    title: "No batches running right now",
    description: "Batches that have started and are still in session will show up here.",
  },
  archived: {
    title: "No archived batches",
    description: "Batches that have finished will be listed here for reference.",
  },
  enrolled: {
    title: "You haven't joined a batch yet",
    description: "Pick an upcoming batch to learn with a cohort, attend live classes and get feedback from instructors.",
  },
  unpublished: {
    title: "No unpublished batches",
    description: "Batches you create start unpublished. Publish them from the batch settings when they are ready.",
  },
};

export default async function BatchesPage(props: PageProps<"/batches">) {
  const [user, settings, sp] = await Promise.all([getCurrentUser(), getSettings(), props.searchParams]);
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
  const empty = emptyCopy[tab];

  const canonicalView = tab === "upcoming" && !filtered;
  const publicBatches = batches.filter((b) => b.published);

  return (
    <div className="animate-fade-in">
      {canonicalView && publicBatches.length > 0 && (
        <JsonLd data={itemListJsonLd("Upcoming batches", publicBatches.map((b) => ({ name: b.title, path: batchPath(b.slug), image: b.imageUrl })), { origin: siteOrigin() })} />
      )}
      <PageHeader
        title="All Batches"
        description="Learn with a cohort: scheduled live classes, a shared timetable, assessments and instructor support."
        actions={
          user && canCreateBatch(user) ? (
            <>
              <ButtonLink href="/admin/batches" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
                Manage
              </ButtonLink>
              <ButtonLink href="/admin/batches/new" leftIcon={<Icon.Plus className="size-4" />}>
                New Batch
              </ButtonLink>
            </>
          ) : null
        }
      />

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Tabs items={tabs.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }))} className="lg:flex-1" />
        <ListFilters categories={categories.map((c) => ({ value: c.slug, label: c.name }))} certification placeholder="Search batches" />
      </div>

      <p className="sr-only" role="status">
        {batches.length === 0 ? "No Batches Found" : batches.length === 1 ? "1 result loaded" : `${batches.length} results loaded`}
      </p>

      {batches.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Icon.Search />}
            title="No batches match your filters"
            description="Try a different search term or clear the filters."
            action={
              <ButtonLink href={tab === "upcoming" ? "/batches" : `/batches?tab=${tab}`} variant="outline">
                Clear filters
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon.Users />}
            title={empty.title}
            description={empty.description}
            action={
              tab === "unpublished" || (tab === "upcoming" && user && canCreateBatch(user)) ? (
                <ButtonLink href="/admin/batches/new" leftIcon={<Icon.Plus className="size-4" />}>
                  New Batch
                </ButtonLink>
              ) : tab === "enrolled" ? (
                <ButtonLink href="/batches">Browse upcoming batches</ButtonLink>
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

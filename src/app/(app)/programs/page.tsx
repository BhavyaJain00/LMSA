import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canCreateProgram, getProgramSummaries, getProgramTabCounts } from "@/lib/data/programs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { ListFilters } from "@/components/batches/list-filters";
import { ProgramCard } from "@/components/programs/program-card";
import type { ProgramListTab } from "@/components/programs/types";
import { itemListJsonLd } from "@/lib/seo/jsonld";
import { listingIndexing, pageMetadata } from "@/lib/seo/metadata";
import { programPath } from "@/lib/seo/content-index";
import { siteOrigin } from "@/lib/seo/site";
import { JsonLd } from "@/components/seo/json-ld";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/programs">): Promise<Metadata> {
  const [settings, sp, t, locale] = await Promise.all([getSettings(), props.searchParams, getT("public"), getLocale()]);
  const { noindex, follow } = listingIndexing({
    search: typeof sp.search === "string" ? sp.search : undefined,
    filters: [typeof sp.tab === "string" && sp.tab !== "published" ? sp.tab : undefined],
  });
  return pageMetadata(
    {
      title: t("programs.meta.title"),
      description: [t("programs.meta.description", { brand: settings.brand.name })],
      path: "/programs",
      locale,
      noindex: noindex || !settings.features.programs,
      follow,
    },
    settings,
  );
}

export default async function ProgramsPage(props: PageProps<"/programs">) {
  const [user, settings, sp, t] = await Promise.all([getCurrentUser(), getSettings(), props.searchParams, getT("public")]);
  if (!settings.features.programs) notFound();
  if (!user && !settings.learning.allowGuestAccess) redirect("/login?next=%2Fprograms");

  const tab: ProgramListTab = user && sp.tab === "enrolled" ? "enrolled" : "published";
  const search = typeof sp.search === "string" ? sp.search : undefined;
  const [programs, counts] = await Promise.all([getProgramSummaries(user, { tab, search }), getProgramTabCounts(user)]);
  const tabs = [{ value: "published", label: t("programs.tabs.published"), count: counts.published }];
  if (user) tabs.push({ value: "enrolled", label: t("programs.tabs.enrolled"), count: counts.enrolled });

  const listed = tab === "published" && !search ? programs.filter((p) => p.published) : [];

  return (
    <div className="animate-fade-in">
      {listed.length > 0 && <JsonLd data={itemListJsonLd("Learning programs", listed.map((p) => ({ name: p.title, path: programPath(p.slug) })), { origin: siteOrigin() })} />}
      <PageHeader
        title={t("programs.title")}
        description={t("programs.description")}
        actions={
          user && canCreateProgram(user) ? (
            <>
              <ButtonLink href="/admin/programs" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
                {t("batches.manage")}
              </ButtonLink>
              <ButtonLink href="/admin/programs/new" leftIcon={<Icon.Plus className="size-4" />}>
                {t("catalog.create.button")}
              </ButtonLink>
            </>
          ) : null
        }
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Tabs items={tabs} className="sm:flex-1" />
        <ListFilters placeholder={t("programs.searchPlaceholder")} />
      </div>

      {programs.length === 0 ? (
        search ? (
          <EmptyState icon={<Icon.Search />} title={t("programs.empty.searchTitle")} description={t("programs.empty.searchDescription")} />
        ) : (
          <EmptyState
            icon={<Icon.GraduationCap />}
            title={tab === "enrolled" ? t("programs.empty.enrolledTitle") : t("programs.empty.publishedTitle")}
            description={tab === "enrolled" ? t("programs.empty.enrolledDescription") : t("programs.empty.publishedDescription")}
            action={tab === "enrolled" && counts.published > 0 ? <ButtonLink href="/programs">{t("programs.browse")}</ButtonLink> : null}
          />
        )
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {programs.map((p) => (
            <ProgramCard key={p.id} program={p} />
          ))}
        </div>
      )}
    </div>
  );
}

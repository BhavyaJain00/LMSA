import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { User } from "@/lib/types";
import { getCurrentUser, isCreator, isModerator } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import {
  CATALOG_PAGE_SIZES,
  CATALOG_SORTS,
  catalogTabsFor,
  getCatalogCategories,
  getCatalogCourses,
  getCatalogTabCounts,
  getCategoryBySlug,
  parseCatalogSort,
  parseCatalogTab,
  parsePage,
  parsePageSize,
  type CatalogTab,
} from "@/lib/data/catalog";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { CatalogFooter } from "@/components/catalog/catalog-footer";
import { CatalogTabs, type CatalogTabLink } from "@/components/catalog/catalog-tabs";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { CourseGrid } from "@/components/catalog/course-grid";
import { CATALOG_QUERY_KEYS, catalogHref, firstParam, type CatalogParams } from "@/components/catalog/catalog-params";
import { listingIndexing, pageMetadata } from "@/lib/seo/metadata";
import { siteOrigin } from "@/lib/seo/site";
import { courseItemList } from "@/lib/data/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { getLocale, getT } from "@/i18n/server";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";

type PublicT = Translator<MessageKey<"public">>;

function readParams(sp: Record<string, string | string[] | undefined>): CatalogParams {
  const out: CatalogParams = {};
  for (const key of CATALOG_QUERY_KEYS) {
    const value = firstParam(sp[key]);
    if (value) out[key] = value;
  }
  // Legacy Frappe query name for search.
  if (!out.search) {
    const title = firstParam(sp.title);
    if (title) out.search = title;
  }
  return out;
}

export async function generateMetadata(props: PageProps<"/courses">): Promise<Metadata> {
  const params = readParams(await props.searchParams);
  const [settings, t, locale] = await Promise.all([getSettings(), getT("public"), getLocale()]);
  const category = await getCategoryBySlug(params.category);
  const search = params.search?.trim();
  const title = search
    ? t("catalog.meta.searchTitle", { search: search.slice(0, 60) })
    : category
      ? t("catalog.meta.categoryTitle", { category: category.name })
      : t("catalog.meta.title");
  const description = category
    ? [category.seoDescription, category.intro, t("catalog.meta.categoryDescription", { category: category.name, brand: settings.brand.name })]
    : [t("catalog.meta.description", { brand: settings.brand.name })];
  // Every search, sort, filter, tab or "load more" permutation canonicalises to the plain catalog.
  const { noindex, follow } = listingIndexing({
    search,
    sort: params.sort,
    filters: [params.category, params.tab && params.tab !== "live" ? params.tab : undefined, params.certification, params.limit],
    page: Number(params.page) || 1,
  });
  return pageMetadata({ title, description, path: "/courses", noindex, follow, locale }, settings);
}

function emptyStateFor(t: PublicT, tab: CatalogTab, opts: { filtered: boolean; clearHref: string; viewer: User | null }) {
  if (opts.filtered) {
    return (
      <EmptyState
        icon={<Icon.Search />}
        title={t("catalog.empty.filteredTitle")}
        description={t("catalog.empty.filteredDescription")}
        action={
          <ButtonLink href={opts.clearHref} variant="outline" leftIcon={<Icon.X className="size-4" />}>
            {t("catalog.filters.clear")}
          </ButtonLink>
        }
      />
    );
  }
  switch (tab) {
    case "enrolled":
      return (
        <EmptyState
          icon={<Icon.BookOpen />}
          title={t("catalog.empty.enrolledTitle")}
          description={t("catalog.empty.enrolledDescription")}
          action={<ButtonLink href="/courses">{t("catalog.browseCourses")}</ButtonLink>}
        />
      );
    case "created":
      return (
        <EmptyState
          icon={<Icon.GraduationCap />}
          title={t("catalog.empty.createdTitle")}
          description={t("catalog.empty.createdDescription")}
          action={
            isCreator(opts.viewer) ? (
              <ButtonLink href="/admin/courses/new" leftIcon={<Icon.Plus className="size-4" />}>
                {t("catalog.create.course")}
              </ButtonLink>
            ) : undefined
          }
        />
      );
    case "unpublished":
      return <EmptyState icon={<Icon.EyeOff />} title={t("catalog.empty.unpublishedTitle")} description={t("catalog.empty.unpublishedDescription")} />;
    case "upcoming":
      return (
        <EmptyState
          icon={<Icon.Calendar />}
          title={t("catalog.empty.upcomingTitle")}
          description={t("catalog.empty.upcomingDescription")}
          action={
            <ButtonLink href="/courses" variant="outline">
              {t("catalog.empty.seeLive")}
            </ButtonLink>
          }
        />
      );
    case "new":
      return (
        <EmptyState
          icon={<Icon.Sparkles />}
          title={t("catalog.empty.newTitle")}
          description={t("catalog.empty.newDescription")}
          action={
            <ButtonLink href="/courses" variant="outline">
              {t("catalog.empty.seeLive")}
            </ButtonLink>
          }
        />
      );
    default:
      return <EmptyState icon={<Icon.BookOpen />} title={t("catalog.empty.title")} description={t("catalog.empty.description")} />;
  }
}

function FilterChip({ label, removeHref, removeLabel }: { label: React.ReactNode; removeHref: string; removeLabel: string }) {
  return (
    <li>
      <Link
        href={removeHref}
        scroll={false}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 py-1 ps-3 pe-2 text-xs font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-2"
      >
        {label}
        <Icon.X className="size-3.5 text-ink-faint" aria-hidden="true" />
        <span className="sr-only">{removeLabel}</span>
      </Link>
    </li>
  );
}

export default async function CoursesPage(props: PageProps<"/courses">) {
  const sp = await props.searchParams;
  const [user, settings, t] = await Promise.all([getCurrentUser(), getSettings(), getT("public")]);

  // Legacy Frappe deep link for the "New Course" form.
  if (firstParam(sp.newCourse) === "1" && isCreator(user)) redirect("/admin/courses/new");

  const creator = isCreator(user);
  const header = (
    <PageHeader
      title={t("catalog.title")}
      description={t("catalog.description", { brand: settings.brand.name })}
      actions={
        creator ? (
          <Dropdown
            trigger={
              <span className={buttonClasses({ variant: "primary" })}>
                <Icon.Plus className="size-4" aria-hidden="true" />
                {t("catalog.create.button")}
                <Icon.ChevronDown className="size-4" aria-hidden="true" />
              </span>
            }
            items={[
              { label: t("catalog.create.new"), icon: <Icon.BookOpen />, href: "/admin/courses/new", description: t("catalog.create.newDescription") },
              { label: t("catalog.create.import"), icon: <Icon.Upload />, href: "/admin/courses/import", description: t("catalog.create.importDescription") },
              { label: t("catalog.create.manage"), icon: <Icon.Layout />, href: "/admin/courses", description: t("catalog.create.manageDescription") },
            ]}
          />
        ) : undefined
      }
    />
  );

  if (!settings.features.courses) {
    return (
      <div className="animate-fade-in">
        {header}
        <EmptyState
          icon={<Icon.BookOpen />}
          title={t("catalog.disabled.title")}
          description={t("catalog.disabled.description")}
          action={
            user && isModerator(user) ? (
              <ButtonLink href="/admin/settings" variant="outline">
                {t("catalog.disabled.openSettings")}
              </ButtonLink>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (!user && !settings.learning.allowGuestAccess) {
    return (
      <div className="animate-fade-in">
        {header}
        <EmptyState
          icon={<Icon.Lock />}
          title={t("catalog.membersOnly.title")}
          description={t("catalog.membersOnly.description", { brand: settings.brand.name })}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/login?next=%2Fcourses">{t("catalog.logIn")}</ButtonLink>
              {!settings.learning.disableSignup && (
                <ButtonLink href="/register?next=%2Fcourses" variant="outline">
                  {t("catalog.signUp")}
                </ButtonLink>
              )}
            </div>
          }
        />
      </div>
    );
  }

  const params = readParams(sp);
  const tab = parseCatalogTab(params.tab, user);
  const sort = parseCatalogSort(params.sort);
  const pageSize = parsePageSize(params.limit);
  const page = parsePage(params.page);
  const certification = params.certification === "true" && settings.features.certifications;
  const search = params.search?.trim().slice(0, 100) || undefined;
  const query = { tab, search, categorySlug: params.category, certification, sort };

  const [{ courses, category }, counts, categories] = await Promise.all([
    getCatalogCourses(user, query),
    getCatalogTabCounts(user, query),
    getCatalogCategories(),
  ]);

  const visible = courses.slice(0, pageSize * page);
  const nextHref = visible.length < courses.length ? catalogHref(params, { page: String(page + 1) }) : null;

  const tabs: CatalogTabLink[] = catalogTabsFor(user).map((def) => ({
    value: def.value,
    label: t(`catalog.tabs.${def.value}.label`),
    description: t(`catalog.tabs.${def.value}.description`),
    href: catalogHref(params, { tab: def.value === "live" ? null : def.value, page: null }),
    count: counts[def.value],
    active: def.value === tab,
  }));

  const filtered = !!search || !!category || certification;
  const clearHref = catalogHref({ tab: params.tab, sort: params.sort, limit: params.limit }, {});
  const activeTab = tabs.find((item) => item.active);
  const bold = (chunks: React.ReactNode) => <span className="font-medium text-ink">{chunks}</span>;
  const tabLabel = activeTab && tab !== "live" ? activeTab.label.toLocaleLowerCase(t.locale) : null;

  // Structured data only for the canonical view (the plain list crawlers index).
  const canonicalView = tab === "live" && !filtered && !params.sort && page === 1;

  return (
    <div className="animate-fade-in">
      {canonicalView && visible.length > 0 && <JsonLd data={courseItemList("All courses", visible, { origin: siteOrigin() })} />}
      {header}

      <div className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <CatalogTabs tabs={tabs} />
        </div>
        <CatalogToolbar
          categories={categories.map((c) => ({ slug: c.slug, name: c.name, courseCount: c.courseCount }))}
          sorts={CATALOG_SORTS.map((s) => ({ value: s.value, label: t(`catalog.sort.${s.value}`) }))}
          category={category?.slug ?? ""}
          sort={sort}
          certification={certification}
          showCertification={settings.features.certifications}
        />
      </div>

      <div className="mb-5 mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {courses.length === 0
            ? t("catalog.empty.title")
            : tabLabel
              ? search
                ? t.rich("catalog.results.inTabForSearch", { count: courses.length, tab: tabLabel, search, b: bold })
                : t.rich("catalog.results.inTab", { count: courses.length, tab: tabLabel, b: bold })
              : search
                ? t.rich("catalog.results.forSearch", { count: courses.length, search, b: bold })
                : t.rich("catalog.results.count", { count: courses.length, b: bold })}
        </p>
        {filtered && (
          <ul className="flex flex-wrap items-center gap-2" aria-label={t("catalog.filters.active")}>
            {search && (
              <FilterChip
                label={t("catalog.filters.searchChip", { search })}
                removeHref={catalogHref(params, { search: null, page: null })}
                removeLabel={t("catalog.filters.remove")}
              />
            )}
            {category && (
              <FilterChip label={category.name} removeHref={catalogHref(params, { category: null, page: null })} removeLabel={t("catalog.filters.remove")} />
            )}
            {certification && (
              <FilterChip
                label={t("catalog.filters.certification")}
                removeHref={catalogHref(params, { certification: null, page: null })}
                removeLabel={t("catalog.filters.remove")}
              />
            )}
            <li>
              <Link href={clearHref} scroll={false} className="text-xs font-medium text-accent hover:underline">
                {t("catalog.filters.clearAll")}
              </Link>
            </li>
          </ul>
        )}
      </div>

      <CourseGrid courses={visible} headingLevel="h2" eagerCount={4} empty={emptyStateFor(t, tab, { filtered, clearHref, viewer: user })} />

      {courses.length > 0 && (
        <CatalogFooter shown={visible.length} total={courses.length} pageSize={pageSize} pageSizes={CATALOG_PAGE_SIZES} nextHref={nextHref} />
      )}
      {/* Single polite live region for result changes (filters, tabs and "load more"). */}
      <p className="sr-only" role="status">
        {visible.length < courses.length ? t("catalog.results.showing", { shown: visible.length, total: courses.length }) : t("catalog.results.found", { count: courses.length })}
      </p>
    </div>
  );
}

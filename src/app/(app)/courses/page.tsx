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
  const settings = await getSettings();
  const category = await getCategoryBySlug(params.category);
  const title = params.search ? `Search results for “${params.search}”` : category ? `${category.name} courses` : "All Courses";
  const description = category
    ? `Browse ${category.name.toLowerCase()} courses on ${settings.brand.name}.`
    : `Browse self-paced courses with videos, quizzes, assignments and certificates on ${settings.brand.name}.`;
  return {
    title,
    description,
    robots: params.search ? { index: false, follow: true } : undefined,
    openGraph: { title: `${title} · ${settings.brand.name}`, description },
  };
}

function emptyStateFor(tab: CatalogTab, opts: { filtered: boolean; clearHref: string; viewer: User | null }) {
  if (opts.filtered) {
    return (
      <EmptyState
        icon={<Icon.Search />}
        title="No courses match your filters"
        description="Try a different search term, pick another category or clear the filters."
        action={
          <ButtonLink href={opts.clearHref} variant="outline" leftIcon={<Icon.X className="size-4" />}>
            Clear filters
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
          title="You haven't enrolled in any courses yet"
          description="Courses you join will appear here with your progress, so you can pick up right where you left off."
          action={<ButtonLink href="/courses">Browse courses</ButtonLink>}
        />
      );
    case "created":
      return (
        <EmptyState
          icon={<Icon.GraduationCap />}
          title="No courses created"
          description="There are no courses currently. Create your first course to get started!"
          action={
            isCreator(opts.viewer) ? (
              <ButtonLink href="/admin/courses/new" leftIcon={<Icon.Plus className="size-4" />}>
                Create Course
              </ButtonLink>
            ) : undefined
          }
        />
      );
    case "unpublished":
      return <EmptyState icon={<Icon.EyeOff />} title="No unpublished courses" description="Drafts and courses awaiting review will appear here." />;
    case "upcoming":
      return (
        <EmptyState
          icon={<Icon.Calendar />}
          title="No upcoming courses"
          description="Announced courses show up here before they open for enrollment. Keep an eye out!"
          action={
            <ButtonLink href="/courses" variant="outline">
              See live courses
            </ButtonLink>
          }
        />
      );
    case "new":
      return (
        <EmptyState
          icon={<Icon.Sparkles />}
          title="No new courses"
          description="Nothing has been published in the last 30 days. Check back soon for fresh courses."
          action={
            <ButtonLink href="/courses" variant="outline">
              See live courses
            </ButtonLink>
          }
        />
      );
    default:
      return (
        <EmptyState
          icon={<Icon.BookOpen />}
          title="No Courses Found"
          description="There are no courses currently. Keep an eye out, fresh learning experiences are on the way!"
        />
      );
  }
}

function FilterChip({ label, removeHref }: { label: React.ReactNode; removeHref: string }) {
  return (
    <li>
      <Link
        href={removeHref}
        scroll={false}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 py-1 pl-3 pr-2 text-xs font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-2"
      >
        {label}
        <Icon.X className="size-3.5 text-ink-faint" aria-hidden="true" />
        <span className="sr-only">Remove filter</span>
      </Link>
    </li>
  );
}

export default async function CoursesPage(props: PageProps<"/courses">) {
  const sp = await props.searchParams;
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);

  // Legacy Frappe deep link for the "New Course" form.
  if (firstParam(sp.newCourse) === "1" && isCreator(user)) redirect("/admin/courses/new");

  const creator = isCreator(user);
  const header = (
    <PageHeader
      title="All Courses"
      description={`Learn at your own pace with hands-on courses from the ${settings.brand.name} community.`}
      actions={
        creator ? (
          <Dropdown
            trigger={
              <span className={buttonClasses({ variant: "primary" })}>
                <Icon.Plus className="size-4" aria-hidden="true" />
                Create
                <Icon.ChevronDown className="size-4" aria-hidden="true" />
              </span>
            }
            items={[
              { label: "New Course", icon: <Icon.BookOpen />, href: "/admin/courses/new", description: "Start a course from scratch" },
              { label: "Import course", icon: <Icon.Upload />, href: "/admin/courses/import", description: "Create a course from a JSON export" },
              { label: "Manage courses", icon: <Icon.Layout />, href: "/admin/courses", description: "Edit, publish and track your courses" },
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
          title="Courses are not available"
          description="The course catalog is currently turned off on this platform."
          action={
            user && isModerator(user) ? (
              <ButtonLink href="/admin/settings" variant="outline">
                Open settings
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
          title="Log in to browse courses"
          description={`The ${settings.brand.name} catalog is available to members. Log in or create a free account to explore every course.`}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/login?next=%2Fcourses">Log in</ButtonLink>
              {!settings.learning.disableSignup && (
                <ButtonLink href="/register?next=%2Fcourses" variant="outline">
                  Sign up
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

  const tabs: CatalogTabLink[] = catalogTabsFor(user).map((t) => ({
    value: t.value,
    label: t.label,
    description: t.description,
    href: catalogHref(params, { tab: t.value === "live" ? null : t.value, page: null }),
    count: counts[t.value],
    active: t.value === tab,
  }));

  const filtered = !!search || !!category || certification;
  const clearHref = catalogHref({ tab: params.tab, sort: params.sort, limit: params.limit }, {});
  const activeTab = tabs.find((t) => t.active);

  return (
    <div className="animate-fade-in">
      {header}

      <div className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <CatalogTabs tabs={tabs} />
        </div>
        <CatalogToolbar
          categories={categories.map((c) => ({ slug: c.slug, name: c.name, courseCount: c.courseCount }))}
          sorts={CATALOG_SORTS}
          category={category?.slug ?? ""}
          sort={sort}
          certification={certification}
          showCertification={settings.features.certifications}
        />
      </div>

      <div className="mb-5 mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {courses.length === 0 ? (
            "No Courses Found"
          ) : (
            <>
              <span className="font-medium text-ink">{courses.length}</span> {courses.length === 1 ? "course" : "courses"}
              {activeTab && tab !== "live" && <> in {activeTab.label.toLowerCase()}</>}
              {search && (
                <>
                  {" "}
                  for <span className="font-medium text-ink">“{search}”</span>
                </>
              )}
            </>
          )}
        </p>
        {filtered && (
          <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
            {search && <FilterChip label={<>Search: {search}</>} removeHref={catalogHref(params, { search: null, page: null })} />}
            {category && <FilterChip label={category.name} removeHref={catalogHref(params, { category: null, page: null })} />}
            {certification && <FilterChip label="Certification" removeHref={catalogHref(params, { certification: null, page: null })} />}
            <li>
              <Link href={clearHref} scroll={false} className="text-xs font-medium text-accent hover:underline">
                Clear all
              </Link>
            </li>
          </ul>
        )}
      </div>

      <CourseGrid courses={visible} headingLevel="h2" empty={emptyStateFor(tab, { filtered, clearHref, viewer: user })} />

      {courses.length > 0 && (
        <CatalogFooter shown={visible.length} total={courses.length} pageSize={pageSize} pageSizes={CATALOG_PAGE_SIZES} nextHref={nextHref} />
      )}
      {/* Single polite live region for result changes (filters, tabs and "load more"). */}
      <p className="sr-only" role="status">
        {courses.length === 0
          ? "No courses found"
          : visible.length < courses.length
            ? `Showing ${visible.length} of ${courses.length} courses`
            : courses.length === 1
              ? "1 course found"
              : `${courses.length} courses found`}
      </p>
    </div>
  );
}

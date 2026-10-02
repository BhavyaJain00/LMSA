import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import {
  JOBS_PAGE_SIZE,
  canPostJobs,
  closeExpiredJobs,
  countJobsPostedBy,
  countVisibleClosedJobs,
  getJobCountries,
  getJobs,
  parseJobType,
  parseWorkMode,
} from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { JobCard } from "@/components/jobs/job-bits";
import { JobFilters } from "@/components/jobs/job-filters";
import { listingIndexing, pageMetadata } from "@/lib/seo/metadata";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/jobs">): Promise<Metadata> {
  const [settings, sp, t, locale] = await Promise.all([getSettings(), props.searchParams, getT("public"), getLocale()]);
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const page = Number(one("page") || 1);
  // Status, search, type, mode, country and "load more" permutations canonicalise to the open-jobs list.
  const { noindex, follow } = listingIndexing({
    search: one("search"),
    filters: [one("status"), one("type"), one("mode") || one("work_mode"), one("country")],
    page: Number.isFinite(page) ? page : 1,
  });
  return pageMetadata(
    {
      title: t("jobs.meta.title"),
      description: [t("jobs.meta.description", { brand: settings.brand.name })],
      path: "/jobs",
      locale,
      noindex: noindex || !settings.features.jobs,
      follow,
    },
    settings,
  );
}

export default async function JobsPage(props: PageProps<"/jobs">) {
  const [settings, viewer, sp, t] = await Promise.all([getSettings(), getCurrentUser(), props.searchParams, getT("public")]);
  if (!settings.features.jobs) notFound();
  if (!viewer && !settings.learning.allowGuestAccess) redirect(`/login?next=${encodeURIComponent("/jobs")}`);
  await closeExpiredJobs();

  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const [closedCount, postedCount] = await Promise.all([countVisibleClosedJobs(viewer), countJobsPostedBy(viewer?.id)]);
  const status = one("status") === "closed" && closedCount > 0 ? "closed" : "open";
  const search = one("search").trim();
  const type = parseJobType(one("type"));
  // `work_mode` is accepted as an alias so links from the reference app keep working.
  const mode = parseWorkMode(one("mode") || one("work_mode"));
  // Country filter is for signed-in members only (hidden for guests).
  const country = viewer ? one("country").trim().slice(0, 80) : "";
  const countries = viewer ? await getJobCountries(viewer, status) : null;
  const canPost = canPostJobs(viewer, settings.features.jobs);
  const pageRaw = Number(one("page") || 1);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100) : 1;

  const jobs = await getJobs(viewer, { status, search, type, workMode: mode, country: country || undefined });
  const filtered = !!(search || type || mode || country);
  const openTotal = status === "open" && !filtered ? jobs.length : undefined;
  const visible = jobs.slice(0, page * JOBS_PAGE_SIZE);
  const staff = isStaff(viewer);

  const moreQuery = new URLSearchParams();
  if (status === "closed") moreQuery.set("status", "closed");
  if (search) moreQuery.set("search", search);
  if (type) moreQuery.set("type", type);
  if (mode) moreQuery.set("mode", mode);
  if (country) moreQuery.set("country", country);
  moreQuery.set("page", String(page + 1));

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: t("jobs.meta.title") }]} />}
        title={status === "closed" ? t("jobs.board.closedTitle", { count: jobs.length }) : t("jobs.board.openTitle", { count: jobs.length })}
        description={t("jobs.board.description")}
        actions={
          <>
            {viewer && (
              <ButtonLink href="/jobs/applications" variant="outline" leftIcon={<Icon.ClipboardList className="size-4" />}>
                {t("jobs.myApplications.title")}
              </ButtonLink>
            )}
            {viewer && postedCount > 0 && (
              <ButtonLink href="/jobs/mine" variant="outline" leftIcon={<Icon.Briefcase className="size-4" />}>
                {t("jobs.mine.title")}
              </ButtonLink>
            )}
            {canPost && (
              <ButtonLink href="/jobs/new" leftIcon={<Icon.Plus className="size-4" />}>
                {t("catalog.create.button")}
              </ButtonLink>
            )}
          </>
        }
      />

      <JobFilters
        values={{ status, search, type: type ?? "", mode: mode ?? "", country }}
        countries={countries}
        showClosedTab={closedCount > 0}
        openCount={openTotal}
        closedCount={closedCount}
      />

      <div className="mt-6">
        {visible.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Icon.Search />}
              title={t("jobs.board.noMatchTitle")}
              description={viewer ? t("jobs.board.noMatchMember") : t("jobs.board.noMatchGuest")}
              action={
                <ButtonLink href={status === "closed" ? "/jobs?status=closed" : "/jobs"} variant="outline">
                  {t("batches.clearFilters")}
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              icon={<Icon.Briefcase />}
              title={t("jobs.board.emptyTitle")}
              description={t("jobs.board.emptyDescription")}
              action={
                canPost ? (
                  <ButtonLink href="/jobs/new" leftIcon={<Icon.Plus className="size-4" />}>
                    {t("jobs.postJob")}
                  </ButtonLink>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((job) => (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    showApplicants={staff || (!!viewer && job.postedById === viewer.id)}
                  />
                </li>
              ))}
            </ul>
            {jobs.length > visible.length && (
              <div className="mt-6 flex justify-center">
                <ButtonLink href={`/jobs?${moreQuery}`} variant="outline">
                  {t("jobs.board.loadMore")}
                </ButtonLink>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

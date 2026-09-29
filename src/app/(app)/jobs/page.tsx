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

export const metadata = { title: "Jobs", description: "Job openings shared with our learning community." };

export default async function JobsPage(props: PageProps<"/jobs">) {
  const [settings, viewer, sp] = await Promise.all([getSettings(), getCurrentUser(), props.searchParams]);
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
        breadcrumbs={<Breadcrumbs items={[{ label: "Jobs" }]} />}
        title={`${jobs.length} ${status === "closed" ? "Closed" : "Open"} ${jobs.length === 1 ? "Job" : "Jobs"}`}
        description="Opportunities shared with our learning community."
        actions={
          <>
            {viewer && (
              <ButtonLink href="/jobs/applications" variant="outline" leftIcon={<Icon.ClipboardList className="size-4" />}>
                My applications
              </ButtonLink>
            )}
            {viewer && postedCount > 0 && (
              <ButtonLink href="/jobs/mine" variant="outline" leftIcon={<Icon.Briefcase className="size-4" />}>
                My job posts
              </ButtonLink>
            )}
            {canPost && (
              <ButtonLink href="/jobs/new" leftIcon={<Icon.Plus className="size-4" />}>
                Create
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
              title="No jobs match your filters"
              description={viewer ? "Try a different search term, country, job type or work mode." : "Try a different search term, job type or work mode."}
              action={
                <ButtonLink href={status === "closed" ? "/jobs?status=closed" : "/jobs"} variant="outline">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              icon={<Icon.Briefcase />}
              title="No Job Openings Found"
              description="There are no job openings currently. Keep an eye out, fresh learning experiences are on the way!"
              action={
                canPost ? (
                  <ButtonLink href="/jobs/new" leftIcon={<Icon.Plus className="size-4" />}>
                    Post a job
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
                  Load more
                </ButtonLink>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

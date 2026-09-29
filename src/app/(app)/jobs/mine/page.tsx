import Link from "next/link";
import { notFound } from "next/navigation";
import { isModerator, requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { JOB_AUTO_CLOSE_DAYS, canPostJobs, closeExpiredJobs, getManagedJobs } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { CompanyLogo, JOB_TYPE_LABEL, formatJobLocation, workModeLabel } from "@/components/jobs/job-bits";
import { JobRowActions } from "@/components/jobs/job-actions";
import { SearchParamInput } from "@/components/jobs/search-param-input";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "My job posts" };

/** The jobs this member posted, open and closed, with their applicants (owner view). */
export default async function MyJobPostsPage(props: PageProps<"/jobs/mine">) {
  const viewer = await requireUser("/jobs/mine");
  const [settings, sp] = await Promise.all([getSettings(), props.searchParams]);
  if (!settings.features.jobs) notFound();
  await closeExpiredJobs();

  const status = sp.status === "open" || sp.status === "closed" ? sp.status : "all";
  const search = typeof sp.search === "string" ? sp.search : "";
  const [all, jobs] = await Promise.all([
    getManagedJobs(viewer, { status: "all", onlyOwn: true }),
    getManagedJobs(viewer, { status, search, onlyOwn: true }),
  ]);
  const openCount = all.filter((j) => j.status === "open").length;
  const applicants = all.reduce((sum, j) => sum + j.applicantCount, 0);
  const canPost = canPostJobs(viewer, settings.features.jobs);

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Jobs", href: "/jobs" },
              { label: "My job posts" },
            ]}
          />
        }
        title="My job posts"
        description={
          all.length
            ? `${all.length} ${all.length === 1 ? "job" : "jobs"} posted, ${applicants} ${applicants === 1 ? "application" : "applications"} received. Openings close automatically after ${JOB_AUTO_CLOSE_DAYS} days without an update.`
            : "Jobs you post appear here with their applications."
        }
        actions={
          <>
            {isModerator(viewer) && (
              <ButtonLink href="/admin/jobs" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
                All job openings
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

      {all.length === 0 ? (
        <EmptyState
          icon={<Icon.Briefcase />}
          title="You haven't posted any jobs yet"
          description="Hiring? Post an opening and members of the community can apply with their resume."
          action={
            canPost ? (
              <ButtonLink href="/jobs/new" leftIcon={<Icon.Plus className="size-4" />}>
                Post a job
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Tabs
              items={[
                { label: "All", value: "all", count: all.length },
                { label: "Open", value: "open", count: openCount },
                { label: "Closed", value: "closed", count: all.length - openCount },
              ]}
              param="status"
              variant="pills"
            />
            <div className="w-full sm:max-w-xs">
              <SearchParamInput label="Search my jobs" placeholder="Search title, company or location" />
            </div>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Job</TH>
                <TH className="hidden md:table-cell">Type</TH>
                <TH>Status</TH>
                <TH className="hidden sm:table-cell">Applicants</TH>
                <TH className="hidden lg:table-cell">Posted</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {jobs.length === 0 ? (
                <TableEmpty colSpan={6}>{search ? `No jobs match “${search}”.` : "No jobs match this filter."}</TableEmpty>
              ) : (
                jobs.map((job) => (
                  <TR key={job.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/jobs/${job.slug}`} className="block truncate font-medium hover:underline">
                            {job.title}
                          </Link>
                          <p className="truncate text-xs text-ink-muted">
                            {job.company} · {formatJobLocation(job)} · {workModeLabel(job)}
                          </p>
                          <p className="text-xs text-ink-muted sm:hidden">
                            <Link href={`/jobs/${job.slug}/applications`} className="text-accent hover:underline">
                              {job.applicantCount} {job.applicantCount === 1 ? "applicant" : "applicants"}
                            </Link>
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="hidden text-ink-muted md:table-cell">{JOB_TYPE_LABEL[job.type]}</TD>
                    <TD>
                      <StatusBadge status={job.status} />
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Link href={`/jobs/${job.slug}/applications`} className="tabular-nums text-accent hover:underline">
                        {job.applicantCount}
                      </Link>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(job.createdAt)}</TD>
                    <TD className="text-right">
                      <JobRowActions area="member" job={{ id: job.id, slug: job.slug, title: job.title, status: job.status, applicantCount: job.applicantCount }} />
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

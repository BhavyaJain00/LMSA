import Link from "next/link";
import { isAdmin, isModerator, requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getManagedJobs } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { CompanyLogo, JOB_TYPE_LABEL, workModeLabel } from "@/components/jobs/job-bits";
import { JobRowActions } from "@/components/jobs/job-actions";
import { SearchParamInput } from "@/components/jobs/search-param-input";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Job Openings" };

export default async function AdminJobsPage(props: PageProps<"/admin/jobs">) {
  const viewer = await requireRole(["course_creator", "moderator", "batch_evaluator"], "/admin/jobs");
  const [sp, settings] = await Promise.all([props.searchParams, getSettings()]);
  const status = sp.status === "open" || sp.status === "closed" ? sp.status : "all";
  const search = typeof sp.search === "string" ? sp.search : "";

  const [all, jobs] = await Promise.all([getManagedJobs(viewer, { status: "all" }), getManagedJobs(viewer, { status, search })]);
  const openCount = all.filter((j) => j.status === "open").length;

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Job Openings" }]} />}
        title="Job Openings"
        description={isModerator(viewer) ? "Every job posted on the board. Edit, close or review applications." : "Jobs you have posted. Edit, close or review applications."}
        actions={
          <>
            <ButtonLink href="/jobs" variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
              View board
            </ButtonLink>
            <ButtonLink href="/admin/jobs/new" leftIcon={<Icon.Plus className="size-4" />}>
              New job
            </ButtonLink>
          </>
        }
      />

      {!settings.features.jobs && (
        <p className="mb-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          The job board is turned off, so members can&apos;t see these jobs.{" "}
          {isAdmin(viewer) && (
            <Link href="/admin/settings/features" className="font-medium text-accent hover:underline">
              Turn it on in Features
            </Link>
          )}
        </p>
      )}

      {all.length === 0 ? (
        <EmptyState
          icon={<Icon.Briefcase />}
          title="No Job Openings Found"
          description="Share openings from partner companies with your learners. Jobs you post appear on the public board."
          action={
            <ButtonLink href="/admin/jobs/new" leftIcon={<Icon.Plus className="size-4" />}>
              Post a job
            </ButtonLink>
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
              <SearchParamInput label="Search jobs" placeholder="Search title, company or location" />
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
                          <Link href={`/admin/jobs/${job.id}`} className="block truncate font-medium hover:underline">
                            {job.title}
                          </Link>
                          <p className="truncate text-xs text-ink-muted">
                            {job.company} · {job.location} · {workModeLabel(job.remote)}
                          </p>
                          {job.poster && isModerator(viewer) && <p className="truncate text-xs text-ink-faint">Posted by {job.poster.name}</p>}
                        </div>
                      </div>
                    </TD>
                    <TD className="hidden text-ink-muted md:table-cell">{JOB_TYPE_LABEL[job.type]}</TD>
                    <TD>
                      <StatusBadge status={job.status} />
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Link href={`/admin/jobs/${job.id}/applications`} className="tabular-nums text-accent hover:underline">
                        {job.applicantCount}
                      </Link>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(job.createdAt)}</TD>
                    <TD className="text-right">
                      <JobRowActions job={{ id: job.id, slug: job.slug, title: job.title, status: job.status, applicantCount: job.applicantCount }} />
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

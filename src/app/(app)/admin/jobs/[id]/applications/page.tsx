import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { canManageJob, getJobApplications, getJobById } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { SearchParamInput } from "@/components/jobs/search-param-input";
import { formatDate, pluralize, relativeTime } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/admin/jobs/[id]/applications">) {
  const { id } = await props.params;
  const job = await getJobById(id);
  return { title: job ? `Applications · ${job.title}` : "Applications" };
}

export default async function JobApplicationsPage(props: PageProps<"/admin/jobs/[id]/applications">) {
  const { id } = await props.params;
  const viewer = await requireRole(["course_creator", "moderator", "batch_evaluator"], `/admin/jobs/${id}/applications`);
  const sp = await props.searchParams;
  const job = await getJobById(id);
  if (!job) notFound();
  if (!canManageJob(viewer, job)) redirect("/forbidden");
  const search = typeof sp.search === "string" ? sp.search : "";
  const applications = await getJobApplications(job.id, search);

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Jobs", href: "/admin/jobs" },
              { label: job.title, href: `/jobs/${job.slug}` },
              { label: "Applications" },
            ]}
          />
        }
        title={pluralize(job.applicantCount, "Application")}
        description={`${job.title} · ${job.company}`}
        actions={
          <>
            <ButtonLink href={`/admin/jobs/${job.id}`} variant="outline" leftIcon={<Icon.Edit className="size-4" />}>
              Edit job
            </ButtonLink>
            <ButtonLink href={`/jobs/${job.slug}`} variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
              View job
            </ButtonLink>
          </>
        }
      />

      {job.applicantCount === 0 ? (
        <EmptyState
          icon={<Icon.Briefcase />}
          title="No Job Applications Found"
          description={job.status === "open" ? "Applications will appear here as members apply. Share the job link to reach more people." : "This job is closed, so it no longer receives applications."}
          action={
            <ButtonLink href={`/jobs/${job.slug}`} variant="outline">
              Open job page
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="w-full sm:max-w-xs">
            <SearchParamInput label="Search applicants" placeholder="Search name or email" />
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Full Name</TH>
                <TH className="hidden md:table-cell">Email</TH>
                <TH className="hidden lg:table-cell">Cover letter</TH>
                <TH className="hidden sm:table-cell">Applied On</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {applications.length === 0 ? (
                <TableEmpty colSpan={5}>No applicants match “{search}”.</TableEmpty>
              ) : (
                applications.map((a) => {
                  const subject = `Job Application for ${job.title} - ${a.applicant?.name ?? "Applicant"}`;
                  return (
                    <TR key={a.id} className="align-top">
                      <TD>
                        {a.applicant ? (
                          <div className="flex items-center gap-3">
                            <Avatar name={a.applicant.name} src={a.applicant.avatarUrl} size="sm" />
                            <div className="min-w-0">
                              <Link href={`/user/${a.applicant.username}`} className="block truncate font-medium hover:underline">
                                {a.applicant.name}
                              </Link>
                              {a.applicant.headline && <p className="truncate text-xs text-ink-muted">{a.applicant.headline}</p>}
                              <p className="truncate text-xs text-ink-muted md:hidden">{a.applicant.email}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-ink-faint">Deleted member</span>
                        )}
                        {a.coverLetter && (
                          <details className="mt-2 lg:hidden">
                            <summary className="cursor-pointer text-xs font-medium text-accent">Cover letter</summary>
                            <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{a.coverLetter}</p>
                          </details>
                        )}
                      </TD>
                      <TD className="hidden md:table-cell">
                        {a.applicant ? (
                          <a href={`mailto:${a.applicant.email}`} className="text-ink-muted hover:text-ink hover:underline">
                            {a.applicant.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD className="hidden max-w-sm lg:table-cell">
                        {a.coverLetter ? (
                          <details>
                            <summary className="line-clamp-2 cursor-pointer text-sm text-ink-muted">{a.coverLetter}</summary>
                            <p className="mt-2 whitespace-pre-line text-sm text-ink">{a.coverLetter}</p>
                          </details>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </TD>
                      <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell" title={relativeTime(a.createdAt)}>
                        {formatDate(a.createdAt)}
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          {a.resumeUrl && (
                            <a
                              href={a.resumeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-2.5 text-xs font-medium text-ink hover:bg-surface-2"
                            >
                              <Icon.Download className="size-3.5" />
                              <span className="hidden sm:inline">View Resume</span>
                              <span className="sm:hidden">Resume</span>
                            </a>
                          )}
                          {a.applicant && (
                            <a
                              href={`mailto:${a.applicant.email}?subject=${encodeURIComponent(subject)}`}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
                            >
                              <Icon.Mail className="size-3.5" />
                              <span className="hidden sm:inline">Send Email</span>
                              <span className="sr-only sm:hidden">Send Email</span>
                            </a>
                          )}
                        </div>
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

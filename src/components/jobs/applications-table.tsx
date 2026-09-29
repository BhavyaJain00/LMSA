import Link from "next/link";
import type { JobOpening } from "@/lib/types";
import type { ApplicationWithApplicant } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { formatDate, relativeTime } from "@/lib/utils";
import { SearchParamInput } from "./search-param-input";
import { MessageApplicantButton } from "./message-applicant";

/**
 * Applicants of one job (Frappe: JobApplications): name, email, cover
 * letter, resume link, applied date and "Send Email". Shared by the admin
 * page and the poster's own /jobs/[slug]/applications page; the caller is
 * responsible for the owner-or-moderator check.
 */
export function JobApplicationsTable({
  job,
  applicantCount,
  applications,
  search,
  replyTo,
}: {
  job: Pick<JobOpening, "slug" | "title" | "status">;
  applicantCount: number;
  applications: ApplicationWithApplicant[];
  search: string;
  /** Prefilled reply-to address in the message dialog (the viewer's email). */
  replyTo: string;
}) {
  return (
    <>
      {applicantCount === 0 ? (
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
                        <p className="mt-1 text-xs text-ink-muted sm:hidden">Applied {formatDate(a.createdAt)}</p>
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
                            <MessageApplicantButton
                              applicationId={a.id}
                              applicantName={a.applicant.name}
                              applicantEmail={a.applicant.email}
                              jobTitle={job.title}
                              defaultReplyTo={replyTo}
                            />
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
    </>
  );
}

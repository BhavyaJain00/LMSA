import Link from "next/link";
import type { JobOpening } from "@/lib/types";
import type { ApplicationWithApplicant } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icons";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/skeleton";
import { SearchParamInput } from "./search-param-input";
import { MessageApplicantButton } from "./message-applicant";
import { PublicI18n } from "@/components/catalog/public-i18n";
import { getFormatter, getT } from "@/i18n/server";

/**
 * Applicants of one job (Frappe: JobApplications): name, email, cover
 * letter, resume link, applied date and "Send Email". Shared by the admin
 * page and the poster's own /jobs/[slug]/applications page; the caller is
 * responsible for the owner-or-moderator check.
 */
export async function JobApplicationsTable({
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
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  // The send-email dialog is a client component; this table is also used on an admin page, outside the public layouts.
  return (
    <PublicI18n pick={["jobs.message.", "jobs.apply.charCount"]}>
      {applicantCount === 0 ? (
        <EmptyState
          icon={<Icon.Briefcase />}
          title={t("jobs.applications.emptyTitle")}
          description={job.status === "open" ? t("jobs.applications.emptyOpen") : t("jobs.applications.emptyClosed")}
          action={
            <ButtonLink href={`/jobs/${job.slug}`} variant="outline">
              {t("jobs.applications.openJob")}
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="w-full sm:max-w-xs">
            <SearchParamInput label={t("jobs.applications.search")} placeholder={t("jobs.applications.searchPlaceholder")} />
          </div>
          <Table>
            <THead>
              <tr>
                <TH>{t("jobs.applications.name")}</TH>
                <TH className="hidden md:table-cell">{t("jobs.applications.email")}</TH>
                <TH className="hidden lg:table-cell">{t("jobs.apply.coverLetter")}</TH>
                <TH className="hidden sm:table-cell">{t("jobs.applications.appliedOn")}</TH>
                <TH className="text-end">
                  <span className="sr-only">{t("jobs.applications.actions")}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {applications.length === 0 ? (
                <TableEmpty colSpan={5}>{t("jobs.applications.noMatch", { search })}</TableEmpty>
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
                          <span className="text-ink-faint">{t("jobs.applications.deletedMember")}</span>
                        )}
                        <p className="mt-1 text-xs text-ink-muted sm:hidden">{t("jobs.applications.applied", { date: f.date(a.createdAt) })}</p>
                        {a.coverLetter && (
                          <details className="mt-2 lg:hidden">
                            <summary className="cursor-pointer text-xs font-medium text-accent">{t("jobs.apply.coverLetter")}</summary>
                            <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{a.coverLetter}</p>
                          </details>
                        )}
                      </TD>
                      <TD className="hidden md:table-cell">
                        {a.applicant ? (
                          <a href={`mailto:${a.applicant.email}`} dir="ltr" className="text-ink-muted hover:text-ink hover:underline">
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
                      <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell" title={f.relative(a.createdAt)}>
                        {f.date(a.createdAt)}
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
                              <span className="hidden sm:inline">{t("jobs.applications.viewResume")}</span>
                              <span className="sm:hidden">{t("jobs.applications.resume")}</span>
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
    </PublicI18n>
  );
}

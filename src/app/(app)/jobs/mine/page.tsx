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
import { CompanyLogo, formatJobLocation } from "@/components/jobs/job-bits";
import { resolveWorkMode } from "@/components/jobs/work-mode";
import { JobRowActions } from "@/components/jobs/job-actions";
import { SearchParamInput } from "@/components/jobs/search-param-input";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("public");
  return { title: t("jobs.mine.title") };
}

/** The jobs this member posted, open and closed, with their applicants (owner view). */
export default async function MyJobPostsPage(props: PageProps<"/jobs/mine">) {
  const viewer = await requireUser("/jobs/mine");
  const [settings, sp, t, f] = await Promise.all([getSettings(), props.searchParams, getT("public"), getFormatter()]);
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
              { label: t("jobs.meta.title"), href: "/jobs" },
              { label: t("jobs.mine.title") },
            ]}
          />
        }
        title={t("jobs.mine.title")}
        description={
          all.length
            ? t("jobs.mine.summary", { jobs: all.length, applications: applicants, days: JOB_AUTO_CLOSE_DAYS })
            : t("jobs.mine.description")
        }
        actions={
          <>
            {isModerator(viewer) && (
              <ButtonLink href="/admin/jobs" variant="outline" leftIcon={<Icon.Settings className="size-4" />}>
                {t("jobs.mine.allOpenings")}
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

      {all.length === 0 ? (
        <EmptyState
          icon={<Icon.Briefcase />}
          title={t("jobs.mine.emptyTitle")}
          description={t("jobs.mine.emptyDescription")}
          action={
            canPost ? (
              <ButtonLink href="/jobs/new" leftIcon={<Icon.Plus className="size-4" />}>
                {t("jobs.postJob")}
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Tabs
              items={[
                { label: t("jobs.mine.all"), value: "all", count: all.length },
                { label: t("jobs.status.open"), value: "open", count: openCount },
                { label: t("jobs.status.closed"), value: "closed", count: all.length - openCount },
              ]}
              param="status"
              variant="pills"
            />
            <div className="w-full sm:max-w-xs">
              <SearchParamInput label={t("jobs.mine.search")} placeholder={t("jobs.mine.searchPlaceholder")} />
            </div>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>{t("jobs.mine.job")}</TH>
                <TH className="hidden md:table-cell">{t("jobs.form.type")}</TH>
                <TH>{t("jobs.form.status")}</TH>
                <TH className="hidden sm:table-cell">{t("jobs.mine.applicants")}</TH>
                <TH className="hidden lg:table-cell">{t("jobs.mine.posted")}</TH>
                <TH className="w-12">
                  <span className="sr-only">{t("jobs.applications.actions")}</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {jobs.length === 0 ? (
                <TableEmpty colSpan={6}>{search ? t("jobs.mine.noMatchSearch", { search }) : t("jobs.mine.noMatchFilter")}</TableEmpty>
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
                            {job.company} · {formatJobLocation(job)} · {t(`jobs.mode.${resolveWorkMode(job)}`)}
                          </p>
                          <p className="text-xs text-ink-muted sm:hidden">
                            <Link href={`/jobs/${job.slug}/applications`} className="text-accent hover:underline">
                              {t("jobs.applicantCount", { count: job.applicantCount })}
                            </Link>
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="hidden text-ink-muted md:table-cell">{t(`jobs.type.${job.type}`)}</TD>
                    <TD>
                      <StatusBadge status={job.status} />
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Link href={`/jobs/${job.slug}/applications`} className="tabular-nums text-accent hover:underline">
                        {job.applicantCount}
                      </Link>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{f.date(job.createdAt)}</TD>
                    <TD className="text-end">
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

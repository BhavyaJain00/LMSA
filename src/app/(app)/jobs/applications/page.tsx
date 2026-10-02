import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getMyApplications } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { CompanyLogo, formatJobLocation, workModeTone } from "@/components/jobs/job-bits";
import { resolveWorkMode } from "@/components/jobs/work-mode";
import { WithdrawApplicationButton } from "@/components/jobs/job-actions";
import { truncate } from "@/lib/utils";
import { getFormatter, getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("public");
  return { title: t("jobs.myApplications.title") };
}

export default async function MyApplicationsPage() {
  const user = await requireUser("/jobs/applications");
  const settings = await getSettings();
  if (!settings.features.jobs) notFound();
  const [applications, t, f] = await Promise.all([getMyApplications(user.id), getT("public"), getFormatter()]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: t("jobs.meta.title"), href: "/jobs" },
              { label: t("jobs.myApplications.title") },
            ]}
          />
        }
        title={t("jobs.myApplications.title")}
        description={applications.length ? t("jobs.myApplications.count", { count: applications.length }) : t("jobs.myApplications.description")}
        actions={
          <ButtonLink href="/jobs" variant="outline" leftIcon={<Icon.Briefcase className="size-4" />}>
            {t("jobs.myApplications.browse")}
          </ButtonLink>
        }
      />

      {applications.length === 0 ? (
        <EmptyState
          icon={<Icon.ClipboardList />}
          title={t("jobs.myApplications.emptyTitle")}
          description={t("jobs.myApplications.emptyDescription")}
          action={<ButtonLink href="/jobs">{t("jobs.myApplications.find")}</ButtonLink>}
        />
      ) : (
        <ul className="space-y-3">
          {applications.map((a) => (
            <li key={a.id} className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                {a.job ? <CompanyLogo company={a.job.company} logoUrl={a.job.companyLogoUrl} size="sm" /> : <CompanyLogo company="?" size="sm" />}
                <div className="min-w-0 flex-1">
                  {a.job ? (
                    <>
                      <Link href={`/jobs/${a.job.slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
                        {a.job.title}
                      </Link>
                      <p className="text-sm text-ink-muted">
                        {a.job.company} · {formatJobLocation(a.job)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone="accent">{t(`jobs.type.${a.job.type}`)}</Badge>
                        <Badge tone={workModeTone(a.job)}>{t(`jobs.mode.${resolveWorkMode(a.job)}`)}</Badge>
                        {a.job.status === "closed" ? (
                          <Badge tone="neutral" dot>
                            {t("jobs.status.closed")}
                          </Badge>
                        ) : (
                          <Badge tone="success" dot>
                            {t("jobs.status.open")}
                          </Badge>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="font-medium text-ink-muted">{t("jobs.myApplications.removed")}</p>
                  )}
                  {a.coverLetter && <p className="mt-3 text-sm text-ink-muted">“{truncate(a.coverLetter, 220)}”</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                    <span title={f.date(a.createdAt)}>{t("jobs.myApplications.applied", { time: f.relative(a.createdAt) })}</span>
                    {a.resumeUrl && (
                      <a href={a.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                        <Icon.FileText className="size-3.5" />
                        {t("jobs.applications.resume")}
                      </a>
                    )}
                  </div>
                </div>
                <div className="sm:self-center">
                  <WithdrawApplicationButton applicationId={a.id} jobTitle={a.job?.title ?? t("jobs.myApplications.thisJob")} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

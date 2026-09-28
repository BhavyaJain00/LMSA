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
import { CompanyLogo, JOB_TYPE_LABEL, workModeLabel } from "@/components/jobs/job-bits";
import { WithdrawApplicationButton } from "@/components/jobs/job-actions";
import { formatDate, pluralize, relativeTime, truncate } from "@/lib/utils";

export const metadata = { title: "My applications" };

export default async function MyApplicationsPage() {
  const user = await requireUser("/jobs/applications");
  const settings = await getSettings();
  if (!settings.features.jobs) notFound();
  const applications = await getMyApplications(user.id);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Jobs", href: "/jobs" },
              { label: "My applications" },
            ]}
          />
        }
        title="My applications"
        description={applications.length ? `You have applied to ${pluralize(applications.length, "job")}.` : "Jobs you apply to will be listed here."}
        actions={
          <ButtonLink href="/jobs" variant="outline" leftIcon={<Icon.Briefcase className="size-4" />}>
            Browse jobs
          </ButtonLink>
        }
      />

      {applications.length === 0 ? (
        <EmptyState
          icon={<Icon.ClipboardList />}
          title="No applications yet"
          description="When you apply to a job, you can follow it here and withdraw the application if your plans change."
          action={<ButtonLink href="/jobs">Find a job</ButtonLink>}
        />
      ) : (
        <ul className="space-y-3">
          {applications.map((a) => (
            <li key={a.id} className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {a.job ? <CompanyLogo company={a.job.company} logoUrl={a.job.companyLogoUrl} size="sm" /> : <CompanyLogo company="?" size="sm" />}
                <div className="min-w-0 flex-1">
                  {a.job ? (
                    <>
                      <Link href={`/jobs/${a.job.slug}`} className="font-semibold text-ink hover:text-accent hover:underline">
                        {a.job.title}
                      </Link>
                      <p className="text-sm text-ink-muted">
                        {a.job.company} · {a.job.location}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone="accent">{JOB_TYPE_LABEL[a.job.type]}</Badge>
                        <Badge tone={a.job.remote ? "info" : "neutral"}>{workModeLabel(a.job.remote)}</Badge>
                        {a.job.status === "closed" ? (
                          <Badge tone="neutral" dot>
                            Closed
                          </Badge>
                        ) : (
                          <Badge tone="success" dot>
                            Open
                          </Badge>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="font-medium text-ink-muted">This job opening has been removed.</p>
                  )}
                  {a.coverLetter && <p className="mt-3 text-sm text-ink-muted">“{truncate(a.coverLetter, 220)}”</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                    <span title={formatDate(a.createdAt)}>Applied {relativeTime(a.createdAt)}</span>
                    {a.resumeUrl && (
                      <a href={a.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                        <Icon.FileText className="size-3.5" />
                        Resume
                      </a>
                    )}
                  </div>
                </div>
                <div className="sm:self-center">
                  <WithdrawApplicationButton applicationId={a.id} jobTitle={a.job?.title ?? "this job"} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canManageJob, closeExpiredJobs, getJobBySlug, getUserApplication } from "@/lib/data/jobs";
import { Markdown } from "@/lib/markdown";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { notFoundMetadata, pageMetadata } from "@/lib/seo/metadata";
import { isJobPublic } from "@/lib/seo/visibility";
import { jobPath } from "@/lib/seo/content-index";
import { jobTrail } from "@/lib/seo/breadcrumbs";
import { getJobJsonLd } from "@/lib/data/seo";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { CompanyLogo, formatJobLocation, workModeTone } from "@/components/jobs/job-bits";
import { resolveWorkMode } from "@/components/jobs/work-mode";
import { ApplyDialog } from "@/components/jobs/apply-dialog";
import { JobStatusButton, WithdrawApplicationButton } from "@/components/jobs/job-actions";
import { getFormatter, getLocale, getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/jobs/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const [job, viewer, settings, t, locale] = await Promise.all([getJobBySlug(slug), getCurrentUser(), getSettings(), getT("public"), getLocale()]);
  if (!job) return notFoundMetadata(t("jobs.detail.notFound"));
  if (job.status === "closed" && !canManageJob(viewer, job) && !(await getUserApplication(viewer?.id, job.id))) return notFoundMetadata(t("jobs.detail.notFound"));
  return pageMetadata(
    {
      title: t("jobs.detail.metaTitle", { title: job.title, company: job.company }),
      description: [
        job.description,
        job.location
          ? t("jobs.detail.metaHiringIn", { company: job.company, title: job.title, location: job.location })
          : t("jobs.detail.metaHiring", { company: job.company, title: job.title }),
      ],
      path: jobPath(job.slug),
      locale,
      generatedImage: true,
      // Closed openings stay reachable for applicants but leave the index (and Google job search).
      noindex: !isJobPublic(job) || !settings.features.jobs,
    },
    settings,
  );
}

export default async function JobDetailPage(props: PageProps<"/jobs/[slug]">) {
  const { slug } = await props.params;
  await closeExpiredJobs();
  const [settings, viewer, job, t, f] = await Promise.all([getSettings(), getCurrentUser(), getJobBySlug(slug), getT("public"), getFormatter()]);
  if (!settings.features.jobs || !job) notFound();
  if (!viewer && !settings.learning.allowGuestAccess) redirect(`/login?next=${encodeURIComponent(`/jobs/${slug}`)}`);

  const manager = canManageJob(viewer, job);
  const application = await getUserApplication(viewer?.id, job.id);
  // Same visibility rule as the board: closed jobs are only shown to people who manage them or applied.
  if (job.status === "closed" && !manager && !application) notFound();
  const showApplicants = manager || isStaff(viewer);
  const website = job.companyWebsite ? (/^https?:\/\//i.test(job.companyWebsite) ? job.companyWebsite : `https://${job.companyWebsite}`) : null;

  const structuredData = await getJobJsonLd(job);

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <JsonLd data={structuredData} />
      <Breadcrumbs items={jobTrail(job)} structuredData={isJobPublic(job)} />

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {manager && job.applicantCount > 0 && (
          <ButtonLink href={`/jobs/${job.slug}/applications`} variant="subtle" leftIcon={<Icon.Users className="size-4" />}>
            {t("jobs.detail.viewApplications")}
          </ButtonLink>
        )}
        {manager && (
          <ButtonLink href={`/jobs/${job.slug}/edit`} variant="subtle" leftIcon={<Icon.Edit className="size-4" />}>
            {t("jobs.detail.edit")}
          </ButtonLink>
        )}
        {manager && <JobStatusButton jobId={job.id} status={job.status} />}
        {website && (
          <ButtonLink href={website} variant="subtle" leftIcon={<Icon.ExternalLink className="size-4" />}>
            {t("jobs.detail.website")}
          </ButtonLink>
        )}
        {!viewer ? (
          <ButtonLink href={`/login?next=${encodeURIComponent(`/jobs/${job.slug}`)}`} variant="subtle" leftIcon={<Icon.LogIn className="size-4" />}>
            {t("jobs.detail.logInToApply")}
          </ButtonLink>
        ) : application ? (
          <Badge tone="success" size="md">
            <Icon.Check className="size-4" /> {t("jobs.detail.applied")}
          </Badge>
        ) : job.status === "open" ? (
          <ApplyDialog jobId={job.id} jobTitle={job.title} company={job.company} />
        ) : null}
      </div>

      <article className="mt-5 rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-8">
        {job.status === "closed" && (
          <p className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink-muted">
            <Icon.Lock className="size-4 shrink-0" />
            {t("jobs.detail.closed")}
          </p>
        )}
        <header className="flex items-start gap-4">
          {website ? (
            <a href={website} target="_blank" rel="noopener noreferrer" aria-label={t("jobs.detail.companyWebsite", { company: job.company })}>
              <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} size="lg" />
            </a>
          ) : (
            <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} size="lg" />
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{job.title}</h1>
            <p className="mt-1 text-sm font-medium text-ink-muted">
              {t("jobs.detail.companyLocation", { company: job.company, location: formatJobLocation(job) })}
            </p>
          </div>
        </header>

        <div className="mt-5 flex flex-wrap gap-2">
          <Badge size="md">
            <Icon.Calendar className="size-4" />
            {f.relative(job.createdAt)}
          </Badge>
          <Badge size="md" tone="accent">
            <Icon.ClipboardList className="size-4" />
            {t(`jobs.type.${job.type}`)}
          </Badge>
          <Badge size="md" tone={workModeTone(job)}>
            <Icon.Briefcase className="size-4" />
            {t(`jobs.mode.${resolveWorkMode(job)}`)}
          </Badge>
          {job.salaryRange && (
            <Badge size="md">
              <Icon.CreditCard className="size-4" />
              {job.salaryRange}
            </Badge>
          )}
          {showApplicants && job.applicantCount > 0 && (
            <Badge size="md">
              <Icon.User className="size-4" />
              {t("jobs.applicantCount", { count: job.applicantCount })}
            </Badge>
          )}
        </div>

        <div className="my-8 flex items-center gap-3 text-ink-faint" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <Icon.FileText className="size-4" />
          <span className="h-px flex-1 bg-border" />
        </div>

        <Markdown content={job.description} />

        {job.poster && (
          <p className="mt-8 text-xs text-ink-muted">
            {t.rich("jobs.detail.postedBy", {
              date: f.date(job.createdAt),
              name: job.poster.name,
              link: (chunks) => (
                <Link href={`/user/${job.poster!.username}`} className="font-medium text-ink hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
      </article>

      {application && (
        <section className="mt-6 rounded-card border border-success/30 bg-success/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <Icon.CheckCircle className="size-5 text-success" />
                {t("jobs.detail.yourApplication")}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">{t("jobs.detail.submitted", { date: f.date(application.createdAt) })}</p>
            </div>
            <WithdrawApplicationButton applicationId={application.id} jobTitle={job.title} />
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            {application.resumeUrl && (
              <a href={application.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                <Icon.FileText className="size-4" />
                {t("jobs.detail.viewResume")}
              </a>
            )}
            <Link href="/jobs/applications" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
              <Icon.ClipboardList className="size-4" />
              {t("jobs.detail.allApplications")}
            </Link>
          </div>
          {application.coverLetter && <p className="mt-4 whitespace-pre-line rounded-lg bg-surface-1 p-3 text-sm text-ink">{application.coverLetter}</p>}
        </section>
      )}
    </div>
  );
}

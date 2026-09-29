import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canManageJob, closeExpiredJobs, getJobBySlug, getUserApplication } from "@/lib/data/jobs";
import { Markdown } from "@/lib/markdown";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { CompanyLogo, JOB_TYPE_LABEL, formatJobLocation, workModeLabel, workModeTone } from "@/components/jobs/job-bits";
import { ApplyDialog } from "@/components/jobs/apply-dialog";
import { JobStatusButton, WithdrawApplicationButton } from "@/components/jobs/job-actions";
import { formatDate, pluralize, relativeTime, stripMarkdown, truncate } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/jobs/[slug]">) {
  const { slug } = await props.params;
  const [job, viewer] = await Promise.all([getJobBySlug(slug), getCurrentUser()]);
  if (!job) return { title: "Job not found" };
  if (job.status === "closed" && !canManageJob(viewer, job) && !(await getUserApplication(viewer?.id, job.id))) return { title: "Job not found" };
  return { title: `${job.title} at ${job.company}`, description: truncate(stripMarkdown(job.description).replace(/\n/g, " "), 160) };
}

export default async function JobDetailPage(props: PageProps<"/jobs/[slug]">) {
  const { slug } = await props.params;
  await closeExpiredJobs();
  const [settings, viewer, job] = await Promise.all([getSettings(), getCurrentUser(), getJobBySlug(slug)]);
  if (!settings.features.jobs || !job) notFound();
  if (!viewer && !settings.learning.allowGuestAccess) redirect(`/login?next=${encodeURIComponent(`/jobs/${slug}`)}`);

  const manager = canManageJob(viewer, job);
  const application = await getUserApplication(viewer?.id, job.id);
  // Same visibility rule as the board: closed jobs are only shown to people who manage them or applied.
  if (job.status === "closed" && !manager && !application) notFound();
  const showApplicants = manager || isStaff(viewer);
  const website = job.companyWebsite ? (/^https?:\/\//i.test(job.companyWebsite) ? job.companyWebsite : `https://${job.companyWebsite}`) : null;

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <Breadcrumbs
        items={[
          { label: "Jobs", href: "/jobs" },
          { label: job.title },
        ]}
      />

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {manager && job.applicantCount > 0 && (
          <ButtonLink href={`/jobs/${job.slug}/applications`} variant="subtle" leftIcon={<Icon.Users className="size-4" />}>
            View Applications
          </ButtonLink>
        )}
        {manager && (
          <ButtonLink href={`/jobs/${job.slug}/edit`} variant="subtle" leftIcon={<Icon.Edit className="size-4" />}>
            Edit
          </ButtonLink>
        )}
        {manager && <JobStatusButton jobId={job.id} status={job.status} />}
        {website && (
          <ButtonLink href={website} variant="subtle" leftIcon={<Icon.ExternalLink className="size-4" />}>
            Visit Website
          </ButtonLink>
        )}
        {!viewer ? (
          <ButtonLink href={`/login?next=${encodeURIComponent(`/jobs/${job.slug}`)}`} variant="subtle" leftIcon={<Icon.LogIn className="size-4" />}>
            Login to apply
          </ButtonLink>
        ) : application ? (
          <Badge tone="success" size="md">
            <Icon.Check className="size-4" /> You have applied
          </Badge>
        ) : job.status === "open" ? (
          <ApplyDialog jobId={job.id} jobTitle={job.title} company={job.company} />
        ) : null}
      </div>

      <article className="mt-5 rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-8">
        {job.status === "closed" && (
          <p className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink-muted">
            <Icon.Lock className="size-4 shrink-0" />
            This job is closed and no longer accepting applications.
          </p>
        )}
        <header className="flex items-start gap-4">
          {website ? (
            <a href={website} target="_blank" rel="noopener noreferrer" aria-label={`${job.company} website`}>
              <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} size="lg" />
            </a>
          ) : (
            <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} size="lg" />
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{job.title}</h1>
            <p className="mt-1 text-sm font-medium text-ink-muted">
              {job.company} - {formatJobLocation(job)}
            </p>
          </div>
        </header>

        <div className="mt-5 flex flex-wrap gap-2">
          <Badge size="md">
            <Icon.Calendar className="size-4" />
            {relativeTime(job.createdAt)}
          </Badge>
          <Badge size="md" tone="accent">
            <Icon.ClipboardList className="size-4" />
            {JOB_TYPE_LABEL[job.type]}
          </Badge>
          <Badge size="md" tone={workModeTone(job)}>
            <Icon.Briefcase className="size-4" />
            {workModeLabel(job)}
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
              {pluralize(job.applicantCount, "applicant")}
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
            Posted by{" "}
            <Link href={`/user/${job.poster.username}`} className="font-medium text-ink hover:underline">
              {job.poster.name}
            </Link>{" "}
            on {formatDate(job.createdAt)}
          </p>
        )}
      </article>

      {application && (
        <section className="mt-6 rounded-card border border-success/30 bg-success/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <Icon.CheckCircle className="size-5 text-success" />
                Your application
              </h2>
              <p className="mt-1 text-sm text-ink-muted">Submitted {formatDate(application.createdAt)}. The poster will reach out if you&apos;re a match.</p>
            </div>
            <WithdrawApplicationButton applicationId={application.id} jobTitle={job.title} />
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            {application.resumeUrl && (
              <a href={application.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                <Icon.FileText className="size-4" />
                View resume
              </a>
            )}
            <Link href="/jobs/applications" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
              <Icon.ClipboardList className="size-4" />
              All my applications
            </Link>
          </div>
          {application.coverLetter && <p className="mt-4 whitespace-pre-line rounded-lg bg-surface-1 p-3 text-sm text-ink">{application.coverLetter}</p>}
        </section>
      )}
    </div>
  );
}

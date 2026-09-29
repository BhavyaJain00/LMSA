import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canManageJob, getJobBySlug } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { JobForm } from "@/components/jobs/job-form";
import { toJobFormValues } from "@/components/jobs/job-form-values";
import { formatJobLocation } from "@/components/jobs/job-bits";

export async function generateMetadata(props: PageProps<"/jobs/[slug]/edit">) {
  const { slug } = await props.params;
  const job = await getJobBySlug(slug);
  return { title: job ? `Edit ${job.title}` : "Job" };
}

/** Edit a job opening: its poster or a moderator (Frappe: /job-opening/{job}/edit, if_owner). */
export default async function MemberEditJobPage(props: PageProps<"/jobs/[slug]/edit">) {
  const { slug } = await props.params;
  const user = await requireUser(`/jobs/${slug}/edit`);
  const [settings, job] = await Promise.all([getSettings(), getJobBySlug(slug)]);
  if (!settings.features.jobs || !job) notFound();
  if (!canManageJob(user, job)) redirect("/forbidden");
  // Old links may use the id; keep the canonical slug in the address bar.
  if (job.slug !== slug) redirect(`/jobs/${job.slug}/edit`);

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Jobs", href: "/jobs" },
              { label: job.title, href: `/jobs/${job.slug}` },
              { label: "Edit" },
            ]}
          />
        }
        title={job.title}
        description={`${job.company} · ${formatJobLocation(job)}`}
        actions={
          <>
            <ButtonLink href={`/jobs/${job.slug}/applications`} variant="outline" leftIcon={<Icon.Users className="size-4" />}>
              Applications ({job.applicantCount})
            </ButtonLink>
            <ButtonLink href={`/jobs/${job.slug}`} variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
              View
            </ButtonLink>
          </>
        }
      />
      <JobForm job={toJobFormValues(job)} cancelHref={`/jobs/${job.slug}`} />
    </div>
  );
}

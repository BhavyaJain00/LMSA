import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canManageJob, getJobApplications, getJobBySlug } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { JobApplicationsTable } from "@/components/jobs/applications-table";
import { getT } from "@/i18n/server";

export async function generateMetadata(props: PageProps<"/jobs/[slug]/applications">) {
  const { slug } = await props.params;
  const [job, t] = await Promise.all([getJobBySlug(slug), getT("public")]);
  return { title: job ? t("jobs.applications.metaTitle", { title: job.title }) : t("jobs.applications.metaFallback") };
}

/** Applicants for a job: its poster or a moderator (Frappe: /job-openings/{job}/applications). */
export default async function MemberJobApplicationsPage(props: PageProps<"/jobs/[slug]/applications">) {
  const { slug } = await props.params;
  const user = await requireUser(`/jobs/${slug}/applications`);
  const [settings, job, sp, t] = await Promise.all([getSettings(), getJobBySlug(slug), props.searchParams, getT("public")]);
  if (!settings.features.jobs || !job) notFound();
  if (!canManageJob(user, job)) redirect("/forbidden");
  if (job.slug !== slug) redirect(`/jobs/${job.slug}/applications`);
  const search = typeof sp.search === "string" ? sp.search : "";
  const applications = await getJobApplications(job.id, search);

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: t("jobs.meta.title"), href: "/jobs" },
              { label: job.title, href: `/jobs/${job.slug}` },
              { label: t("jobs.applications.metaFallback") },
            ]}
          />
        }
        title={t("jobs.applications.title", { count: job.applicantCount })}
        description={t("jobs.apply.subtitle", { title: job.title, company: job.company })}
        actions={
          <>
            <ButtonLink href={`/jobs/${job.slug}/edit`} variant="outline" leftIcon={<Icon.Edit className="size-4" />}>
              {t("jobs.applications.editJob")}
            </ButtonLink>
            <ButtonLink href={`/jobs/${job.slug}`} variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
              {t("jobs.actions.view")}
            </ButtonLink>
          </>
        }
      />
      <JobApplicationsTable job={job} applicantCount={job.applicantCount} applications={applications} search={search} replyTo={user.email} />
    </div>
  );
}

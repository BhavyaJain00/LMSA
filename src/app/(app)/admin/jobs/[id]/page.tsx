import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { canManageJob, getJobById } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { JobForm } from "@/components/jobs/job-form";

export async function generateMetadata(props: PageProps<"/admin/jobs/[id]">) {
  const { id } = await props.params;
  const job = await getJobById(id);
  return { title: job ? `Edit ${job.title}` : "Job" };
}

export default async function EditJobPage(props: PageProps<"/admin/jobs/[id]">) {
  const { id } = await props.params;
  const viewer = await requireRole(["course_creator", "moderator", "batch_evaluator"], `/admin/jobs/${id}`);
  const job = await getJobById(id);
  if (!job) notFound();
  if (!canManageJob(viewer, job)) redirect("/forbidden");

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Jobs", href: "/admin/jobs" },
              { label: job.title, href: `/jobs/${job.slug}` },
              { label: "Edit" },
            ]}
          />
        }
        title={job.title}
        description={`${job.company} · ${job.location}`}
        actions={
          <>
            <ButtonLink href={`/admin/jobs/${job.id}/applications`} variant="outline" leftIcon={<Icon.Users className="size-4" />}>
              Applications ({job.applicantCount})
            </ButtonLink>
            <ButtonLink href={`/jobs/${job.slug}`} variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
              View
            </ButtonLink>
          </>
        }
      />
      <JobForm
        job={{
          id: job.id,
          slug: job.slug,
          title: job.title,
          company: job.company,
          companyLogoUrl: job.companyLogoUrl,
          companyWebsite: job.companyWebsite,
          location: job.location,
          remote: job.remote,
          type: job.type,
          description: job.description,
          salaryRange: job.salaryRange,
          status: job.status,
        }}
        cancelHref="/admin/jobs"
      />
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { canManageJob, getJobApplications, getJobById } from "@/lib/data/jobs";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { JobApplicationsTable } from "@/components/jobs/applications-table";
import { pluralize } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/admin/jobs/[id]/applications">) {
  const { id } = await props.params;
  const job = await getJobById(id);
  return { title: job ? `Applications · ${job.title}` : "Applications" };
}

export default async function JobApplicationsPage(props: PageProps<"/admin/jobs/[id]/applications">) {
  const { id } = await props.params;
  const viewer = await requireRole(["course_creator", "moderator", "batch_evaluator"], `/admin/jobs/${id}/applications`);
  const sp = await props.searchParams;
  const job = await getJobById(id);
  if (!job) notFound();
  if (!canManageJob(viewer, job)) redirect("/forbidden");
  const search = typeof sp.search === "string" ? sp.search : "";
  const applications = await getJobApplications(job.id, search);

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Jobs", href: "/admin/jobs" },
              { label: job.title, href: `/jobs/${job.slug}` },
              { label: "Applications" },
            ]}
          />
        }
        title={pluralize(job.applicantCount, "Application")}
        description={`${job.title} · ${job.company}`}
        actions={
          <>
            <ButtonLink href={`/admin/jobs/${job.id}`} variant="outline" leftIcon={<Icon.Edit className="size-4" />}>
              Edit job
            </ButtonLink>
            <ButtonLink href={`/jobs/${job.slug}`} variant="outline" leftIcon={<Icon.Eye className="size-4" />}>
              View job
            </ButtonLink>
          </>
        }
      />
      <JobApplicationsTable job={job} applicantCount={job.applicantCount} applications={applications} search={search} replyTo={viewer.email} />
    </div>
  );
}

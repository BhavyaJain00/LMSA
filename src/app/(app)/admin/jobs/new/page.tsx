import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { JobForm } from "@/components/jobs/job-form";

export const metadata = { title: "New Job" };

export default async function NewJobPage() {
  await requireRole(["course_creator", "moderator", "batch_evaluator"], "/admin/jobs/new");
  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Jobs", href: "/admin/jobs" },
              { label: "New Job" },
            ]}
          />
        }
        title="New Job"
        description="Post an opening to the job board. Members can apply with their resume."
      />
      <JobForm job={null} cancelHref="/admin/jobs" />
    </div>
  );
}

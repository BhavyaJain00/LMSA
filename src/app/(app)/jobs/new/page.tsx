import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canPostJobs } from "@/lib/data/jobs";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { JobForm } from "@/components/jobs/job-form";

export const metadata = { title: "New Job" };

/** Any signed-in member can post a job while the board is on (Frappe: /job-opening/new/edit). */
export default async function MemberNewJobPage() {
  const user = await requireUser("/jobs/new");
  const settings = await getSettings();
  if (!settings.features.jobs) notFound();
  if (!canPostJobs(user, settings.features.jobs)) redirect("/forbidden");

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Jobs", href: "/jobs" },
              { label: "New Job" },
            ]}
          />
        }
        title="New Job"
        description="Share an opening with the community. Members apply with their resume and you review applications from My job posts."
      />
      <JobForm job={null} cancelHref="/jobs" />
    </div>
  );
}

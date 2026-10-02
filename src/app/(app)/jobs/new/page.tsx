import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canPostJobs } from "@/lib/data/jobs";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { JobForm } from "@/components/jobs/job-form";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("public");
  return { title: t("jobs.new.title") };
}

/** Any signed-in member can post a job while the board is on (Frappe: /job-opening/new/edit). */
export default async function MemberNewJobPage() {
  const user = await requireUser("/jobs/new");
  const [settings, t] = await Promise.all([getSettings(), getT("public")]);
  if (!settings.features.jobs) notFound();
  if (!canPostJobs(user, settings.features.jobs)) redirect("/forbidden");

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: t("jobs.meta.title"), href: "/jobs" },
              { label: t("jobs.new.title") },
            ]}
          />
        }
        title={t("jobs.new.title")}
        description={t("jobs.new.description")}
      />
      <JobForm job={null} cancelHref="/jobs" />
    </div>
  );
}

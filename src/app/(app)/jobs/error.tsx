"use client";

import { useT } from "@/i18n/client";
import { RouteError } from "@/components/admin/settings/route-error";

export default function JobsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("public");
  return <RouteError error={error} reset={reset} title={t("errors.jobs")} backHref="/jobs" backLabel={t("errors.backToJobs")} />;
}

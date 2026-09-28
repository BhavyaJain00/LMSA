"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function AdminJobsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Job openings failed to load" backHref="/admin/jobs" backLabel="Back to job openings" />;
}

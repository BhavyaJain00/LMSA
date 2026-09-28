"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function JobsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Jobs failed to load" backHref="/jobs" backLabel="Back to jobs" />;
}

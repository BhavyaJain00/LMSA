"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function StatisticsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Statistics couldn't be loaded" />;
}

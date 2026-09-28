"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Your dashboard couldn't be loaded" homeHref="/courses" homeLabel="Browse courses" />;
}

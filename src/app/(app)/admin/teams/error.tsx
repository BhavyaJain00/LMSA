"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function AdminTeamsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Teams failed to load" backHref="/admin" backLabel="Back to admin" />;
}

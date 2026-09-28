"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function MembersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Members failed to load" backHref="/admin/members" backLabel="Back to members" />;
}

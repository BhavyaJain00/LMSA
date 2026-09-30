"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function JoinTeamError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Your invitation failed to load" backHref="/team" backLabel="Go to my team" />;
}

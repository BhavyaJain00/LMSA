"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function OutboxError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="The outbox failed to load" backHref="/admin" backLabel="Back to admin" />;
}

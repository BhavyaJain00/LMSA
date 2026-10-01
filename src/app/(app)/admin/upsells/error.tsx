"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function UpsellsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Upsells failed to load" backHref="/admin/settings" backLabel="Back to settings" />;
}

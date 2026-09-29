"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function SecuritySettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Security settings couldn't be loaded" homeHref="/settings" homeLabel="Back to account settings" />;
}

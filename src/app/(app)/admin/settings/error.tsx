"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="This settings page failed to load" backHref="/admin/settings/general" backLabel="Back to settings" />;
}

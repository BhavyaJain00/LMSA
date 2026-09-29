"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function EmailNotificationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Your email preferences couldn't be loaded" backHref="/settings" backLabel="Back to account settings" />;
}

"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function SubscriptionSettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Your membership couldn't be loaded" homeHref="/settings" homeLabel="Back to account settings" />;
}

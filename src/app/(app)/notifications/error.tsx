"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function NotificationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Notifications couldn't be loaded" />;
}

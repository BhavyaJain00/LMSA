"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function LoginActivityError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Login activity couldn't be loaded" backHref="/admin/settings/security" backLabel="Security settings" />;
}

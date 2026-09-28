"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Account settings couldn't be loaded" />;
}

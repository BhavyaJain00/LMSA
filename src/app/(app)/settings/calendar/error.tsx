"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function CalendarSettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <RouteError error={error} reset={reset} title="Calendar settings couldn't be loaded" homeHref="/settings" homeLabel="Back to account settings" />
    </div>
  );
}

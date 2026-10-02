"use client";

import { RouteError } from "@/components/dashboard/route-error";
import { useT } from "@/i18n/client";

export default function CalendarSettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("account");
  return (
    <div className="mx-auto max-w-3xl">
      <RouteError error={error} reset={reset} title={t("settings.calendar.error")} homeHref="/settings" homeLabel={t("settings.backToSettings")} />
    </div>
  );
}

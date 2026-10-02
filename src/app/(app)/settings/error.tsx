"use client";

import { RouteError } from "@/components/dashboard/route-error";
import { useT } from "@/i18n/client";

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("account");
  return <RouteError error={error} reset={reset} title={t("settings.error")} />;
}

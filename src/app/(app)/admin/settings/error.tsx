"use client";

import { RouteError } from "@/components/admin/settings/route-error";
import { useT } from "@/i18n/client";

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("admin");
  return <RouteError error={error} reset={reset} title={t("errorPages.settings")} backHref="/admin/settings/general" backLabel={t("errorPages.backToSettings")} />;
}

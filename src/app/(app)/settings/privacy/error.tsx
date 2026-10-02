"use client";

import { useEffect } from "react";
import { RouteError } from "@/components/dashboard/route-error";
import { reportClientError } from "@/lib/errors/report";
import { useT } from "@/i18n/client";

export default function PrivacySettingsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT("account");
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title={t("settings.privacy.error")} homeHref="/settings" homeLabel={t("settings.backToSettings")} />;
}

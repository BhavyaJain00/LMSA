"use client";

import { RouteError } from "@/components/admin/settings/route-error";
import { useT } from "@/i18n/client";

export default function EmailNotificationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("account");
  return <RouteError error={error} reset={reset} title={t("settings.notifications.error")} backHref="/settings" backLabel={t("settings.backToSettings")} />;
}

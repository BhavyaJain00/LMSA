"use client";

import { RouteError } from "@/components/admin/settings/route-error";
import { useT } from "@/i18n/client";

export default function AffiliatesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("admin");
  return <RouteError error={error} reset={reset} title={t("errorPages.affiliates")} backHref="/admin" backLabel={t("errorPages.backToAdmin")} />;
}

"use client";

import { useEffect } from "react";
import { RouteError } from "@/components/admin/settings/route-error";
import { reportClientError } from "@/lib/errors/report";
import { useT } from "@/i18n/client";

export default function AuditLogError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT("admin");
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title={t("errorPages.audit")} backHref="/admin/settings/legal" backLabel={t("errorPages.legalSettings")} />;
}

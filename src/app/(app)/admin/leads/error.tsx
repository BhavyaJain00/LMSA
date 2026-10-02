"use client";

import { RouteError } from "@/components/admin/settings/route-error";
import { useT } from "@/i18n/client";

export default function AdminLeadsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT("admin");
  return <RouteError error={error} reset={retry} title={t("errorPages.leads")} backHref="/admin" backLabel={t("errorPages.backToAdmin")} />;
}

"use client";

import { RouteError } from "@/components/admin/settings/route-error";
import { useT } from "@/i18n/client";

/** Not reported to the error log itself: if the log is what fails, reporting would only add noise. */
export default function ErrorLogError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT("admin");
  return <RouteError error={error} reset={retry} title={t("errorPages.errorLog")} backHref="/admin" backLabel={t("errorPages.backToAdmin")} />;
}

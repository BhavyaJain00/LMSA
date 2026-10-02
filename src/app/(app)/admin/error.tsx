"use client";

import { RouteError } from "@/components/dashboard/route-error";
import { useT } from "@/i18n/client";

/** Catches errors on the admin overview and any admin section without its own boundary. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("admin");
  return <RouteError error={error} reset={reset} title={t("errorPages.admin.title")} homeHref="/admin" homeLabel={t("errorPages.backToOverview")} />;
}

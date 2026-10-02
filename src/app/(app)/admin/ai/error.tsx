"use client";

import { RouteError } from "@/components/dashboard/route-error";
import { useT } from "@/i18n/client";

/** Error boundary for the AI tutor review queue, usage dashboard and conversation view. */
export default function AiAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("admin");
  return <RouteError error={error} reset={reset} title={t("errorPages.ai")} homeHref="/admin" homeLabel={t("errorPages.backToOverview")} />;
}

"use client";

import { RouteError } from "@/components/dashboard/route-error";
import { useT } from "@/i18n/client";

export default function DevelopersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("admin");
  return <RouteError error={error} reset={reset} title={t("errorPages.developers")} homeHref="/courses" homeLabel={t("errorPages.browseCourses")} />;
}

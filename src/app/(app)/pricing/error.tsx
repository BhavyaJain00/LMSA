"use client";

import { useT } from "@/i18n/client";
import { RouteError } from "@/components/dashboard/route-error";

export default function PricingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("public");
  return <RouteError error={error} reset={reset} title={t("errors.pricing")} homeHref="/courses" homeLabel={t("catalog.browseCourses")} />;
}

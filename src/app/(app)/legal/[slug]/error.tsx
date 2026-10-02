"use client";

import { useT } from "@/i18n/client";
import { useEffect } from "react";
import { RouteError } from "@/components/dashboard/route-error";
import { reportClientError } from "@/lib/errors/report";

export default function LegalPageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT("public");
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title={t("errors.legal")} homeHref="/" homeLabel={t("errors.goHome")} />;
}

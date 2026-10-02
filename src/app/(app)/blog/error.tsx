"use client";

import { useT } from "@/i18n/client";
import { useEffect } from "react";
import { RouteError } from "@/components/dashboard/route-error";
import { reportClientError } from "@/lib/errors/report";

/** Error boundary for the blog index, archives and articles (keeps the app shell). */
export default function BlogError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT("public");
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title={t("errors.blog")} homeHref="/" homeLabel={t("errors.goHomePage")} />;
}

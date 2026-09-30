"use client";

import { useEffect } from "react";
import { RouteError } from "@/components/dashboard/route-error";
import { reportClientError } from "@/lib/errors/report";

/** Error boundary for the HTML sitemap (keeps the app shell). */
export default function HtmlSitemapError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title="We couldn't load the sitemap" homeHref="/" homeLabel="Go home" />;
}

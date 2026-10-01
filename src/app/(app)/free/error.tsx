"use client";

import { useEffect } from "react";
import { RouteError } from "@/components/dashboard/route-error";
import { reportClientError } from "@/lib/errors/report";

/** Error boundary for the free resources pages (keeps the app shell). */
export default function FreeResourcesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title="We couldn't load this page" homeHref="/" homeLabel="Go home" />;
}

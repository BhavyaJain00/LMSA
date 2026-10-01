"use client";

import { RouteError } from "@/components/admin/settings/route-error";

/** Not reported to the error log itself: if the log is what fails, reporting would only add noise. */
export default function ErrorLogError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} reset={retry} title="The error log couldn't be loaded" backHref="/admin" backLabel="Back to admin" />;
}

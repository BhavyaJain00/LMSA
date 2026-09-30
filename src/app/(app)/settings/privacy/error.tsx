"use client";

import { useEffect } from "react";
import { RouteError } from "@/components/dashboard/route-error";
import { reportClientError } from "@/lib/errors/report";

export default function PrivacySettingsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title="Your privacy settings couldn't be loaded" homeHref="/settings" homeLabel="Back to settings" />;
}

"use client";

import { useEffect } from "react";
import { RouteError } from "@/components/dashboard/route-error";
import { reportClientError } from "@/lib/errors/report";

export default function LegalPageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title="This page couldn't be loaded" homeHref="/" homeLabel="Go home" />;
}

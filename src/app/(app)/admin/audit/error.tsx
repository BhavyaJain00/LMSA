"use client";

import { useEffect } from "react";
import { RouteError } from "@/components/admin/settings/route-error";
import { reportClientError } from "@/lib/errors/report";

export default function AuditLogError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return <RouteError error={error} reset={retry} title="The audit log couldn't be loaded" backHref="/admin/settings/legal" backLabel="Legal settings" />;
}

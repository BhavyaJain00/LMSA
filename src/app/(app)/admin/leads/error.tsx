"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function AdminLeadsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} reset={retry} title="The leads failed to load" backHref="/admin" backLabel="Back to admin" />;
}

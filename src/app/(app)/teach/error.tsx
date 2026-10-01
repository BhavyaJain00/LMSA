"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function TeachError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="The teaching page failed to load" />;
}

"use client";

import { RouteError } from "@/components/admin/settings/route-error";

export default function TeamError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Your team failed to load" />;
}

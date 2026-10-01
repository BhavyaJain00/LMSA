"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function RedeemError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="The gift couldn't be loaded" homeHref="/dashboard" homeLabel="Go to dashboard" />;
}

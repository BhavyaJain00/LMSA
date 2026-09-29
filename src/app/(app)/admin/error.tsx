"use client";

import { RouteError } from "@/components/dashboard/route-error";

/** Catches errors on the admin overview and any admin section without its own boundary. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="This admin page couldn't be loaded" homeHref="/admin" homeLabel="Back to admin overview" />;
}

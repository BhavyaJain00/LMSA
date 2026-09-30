"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function BundlesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Bundles couldn't be loaded" homeHref="/courses" homeLabel="Browse courses" />;
}

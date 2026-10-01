"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function DevelopersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="The API reference couldn't be loaded" homeHref="/courses" homeLabel="Browse courses" />;
}

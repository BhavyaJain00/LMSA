"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function YouError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Your account page couldn't be loaded" />;
}

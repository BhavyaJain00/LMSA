"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function PersonaError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="The welcome questionnaire couldn't be loaded" />;
}

"use client";

import { RouteError } from "@/components/dashboard/route-error";

/** Error boundary for the AI tutor review queue, usage dashboard and conversation view. */
export default function AiAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="The AI tutor review couldn't be loaded" homeHref="/admin" homeLabel="Back to admin overview" />;
}

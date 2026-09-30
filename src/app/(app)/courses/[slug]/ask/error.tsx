"use client";

import { RouteError } from "@/components/dashboard/route-error";

/** Error boundary for the full-page AI tutor; conversations are stored, so reloading loses nothing. */
export default function AskAiError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="The AI tutor couldn't be loaded" homeHref="/courses" homeLabel="Browse courses" />;
}

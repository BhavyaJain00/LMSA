"use client";

import { RouteError } from "@/components/dashboard/route-error";

export default function ProfileError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="This part of the profile couldn't be loaded" />;
}

"use client";

import { GamificationRouteError } from "@/components/gamification/route-error";

export default function PointsHistoryError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset: () => void }) {
  return <GamificationRouteError error={error} onRetry={retry ?? reset} title="Your points couldn't be loaded" />;
}

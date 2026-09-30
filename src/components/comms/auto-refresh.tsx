"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the current page's server data every few seconds while it is
 * visible (a broadcast that is being sent, a run in progress). Rendered only
 * while there is something to wait for.
 */
export function AutoRefresh({ intervalMs = 5_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);
  return null;
}

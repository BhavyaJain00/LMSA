"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const id = window.setInterval(onChange, TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") onChange();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

// Rounded so the snapshot is stable between ticks.
const getSnapshot = (): number | null => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const getServerSnapshot = (): number | null => null;

/**
 * Current time (refreshed every 30 seconds) on the client, `null` during the
 * server render and hydration. Components render a timezone-neutral fallback
 * while it is `null`, which keeps hydration free of mismatches.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

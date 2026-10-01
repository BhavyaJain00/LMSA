"use client";

import { useEffect } from "react";
import type { TrackParams } from "@/lib/seo/tracking";
import { track } from "./tracking-client";

/**
 * Fires one measurement event when it mounts (consent permitting), e.g.
 * `purchase` on the order success page. With `onceKey` the event is sent at
 * most once per browser, so reloading the page does not count it twice.
 */
export function TrackEvent({ event, params, onceKey }: { event: string; params?: TrackParams; onceKey?: string }) {
  const serialized = JSON.stringify(params ?? {});
  useEffect(() => {
    track(event, JSON.parse(serialized) as TrackParams, onceKey);
  }, [event, serialized, onceKey]);
  return null;
}

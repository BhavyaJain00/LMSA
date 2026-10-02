"use client";

import { useCallback } from "react";
import type { BadgeEvent } from "@/lib/types";
import { useT } from "@/i18n/client";

/** Translated label, rule description and threshold label of a badge event. */
export function useBadgeEventText(): (event: BadgeEvent) => { label: string; description: string; threshold: string } {
  const t = useT("admin");
  return useCallback(
    (event: BadgeEvent) => {
      const thresholdKey = `badges.events.${event}.threshold`;
      return {
        label: t(`badges.events.${event}.label` as Parameters<typeof t>[0]),
        description: t(`badges.events.${event}.description` as Parameters<typeof t>[0]),
        threshold: t.has(thresholdKey) ? t(thresholdKey) : "",
      };
    },
    [t],
  );
}

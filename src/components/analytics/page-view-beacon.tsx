"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getConsent } from "@/components/legal/consent-client";
import { createPageViewReporter } from "./page-view-report";

/**
 * Sends one page view per route to `/api/analytics` with `sendBeacon`
 * (fetch keepalive as a fallback). Nothing is sent when the browser asks
 * not to be tracked (Do-Not-Track / Global Privacy Control). What is sent is
 * decided in `page-view-report.ts`.
 *
 * The beacon is mounted by each route group's layout (app, learn, public),
 * so moving between groups remounts it; "first page of this document" is
 * therefore kept at module scope (one reporter per document), not in the
 * component, so a remount never starts a new visit.
 */

const ENDPOINT = "/api/analytics";
const STAGES_KEY = "ll_funnel_stages";

/** One reporter for the whole document (survives remounts across route groups). */
const reportPageView = createPageViewReporter();
/** Funnel stages reported by this tab, when sessionStorage is not available. */
const stagesInMemory = new Set<string>();

/** True the first time this tab reaches `stage` (remembered for the tab's session). */
function firstTimeAt(stage: string): boolean {
  try {
    const seen = new Set<string>((window.sessionStorage.getItem(STAGES_KEY) ?? "").split(",").filter(Boolean));
    if (seen.has(stage)) return false;
    seen.add(stage);
    window.sessionStorage.setItem(STAGES_KEY, [...seen].join(","));
    return true;
  } catch {
    if (stagesInMemory.has(stage)) return false;
    stagesInMemory.add(stage);
    return true;
  }
}

function trackingRefused(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  return nav.doNotTrack === "1" || nav.doNotTrack === "yes" || nav.msDoNotTrack === "1" || win.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/** A reload or back/forward navigation is not a new visit. */
function isFreshNavigation(): boolean {
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  return !nav || nav.type === "navigate";
}

function send(body: Record<string, unknown>): void {
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.(ENDPOINT, data)) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch(ENDPOINT, { method: "POST", body: data, keepalive: true, credentials: "same-origin", headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(() => {});
}

export function PageViewBeacon() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastPath.current === pathname) return;
    lastPath.current = pathname;
    const body = reportPageView(pathname, {
      trackingRefused: trackingRefused(),
      consent: getConsent().analytics,
      freshNavigation: isFreshNavigation(),
      documentReferrer: document.referrer,
      host: window.location.host,
      search: window.location.search,
      firstTimeAt,
    });
    if (body) send(body);
  }, [pathname]);

  return null;
}

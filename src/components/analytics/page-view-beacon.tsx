"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getConsent } from "@/components/legal/consent-client";

/**
 * Sends one page view per route to `/api/analytics` with `sendBeacon`
 * (fetch keepalive as a fallback). Nothing is sent when the browser asks
 * not to be tracked (Do-Not-Track / Global Privacy Control).
 *
 * Only the path is sent (the query string never leaves the page), plus, on
 * the first page of a visit, the referring site's origin and the UTM tags.
 * The current analytics-consent decision goes along: without consent the
 * server stores the page view without any visitor or member id.
 */

const ENDPOINT = "/api/analytics";

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

/** Origin of an external referrer ("" for none or this site). */
function externalReferrer(): string {
  if (!document.referrer) return "";
  try {
    const url = new URL(document.referrer);
    return url.host === window.location.host ? "" : url.origin;
  } catch {
    return "";
  }
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
  const firstView = useRef(true);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastPath.current === pathname) return;
    lastPath.current = pathname;
    const first = firstView.current;
    firstView.current = false;
    if (trackingRefused()) return;

    const referrer = first ? externalReferrer() : "";
    const sameSiteReferrer = first && !!document.referrer && !referrer;
    const body: Record<string, unknown> = { path: pathname, consent: getConsent().analytics, entry: first && isFreshNavigation() && !sameSiteReferrer };
    if (body.entry) {
      if (referrer) body.referrer = referrer;
      const params = new URLSearchParams(window.location.search);
      const utm = { source: params.get("utm_source") ?? undefined, medium: params.get("utm_medium") ?? undefined, campaign: params.get("utm_campaign") ?? undefined };
      if (utm.source || utm.medium || utm.campaign) body.utm = utm;
    }
    send(body);
  }, [pathname]);

  return null;
}

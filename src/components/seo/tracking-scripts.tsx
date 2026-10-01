"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import { type ConsentState, getConsent, onConsentChange } from "@/components/legal/consent-client";
import { normalizeGa4Id, normalizeMetaPixelId, trackingUrl } from "@/lib/seo/tracking";
import { disableGa4, disableMetaPixel, installGa4, installMetaPixel, setTrackingState, track } from "./tracking-client";

export interface TrackingScriptsProps {
  /** `settings.seo.ga4Id` — loaded only after analytics consent. */
  ga4Id?: string;
  /** `settings.seo.metaPixelId` — loaded only after marketing consent. */
  metaPixelId?: string;
}

const UNDECIDED: ConsentState = { analytics: false, marketing: false, decided: false };

/** Consent as a snapshot string, so `useSyncExternalStore` compares by value. */
function consentKey(): string {
  const c = getConsent();
  return `${c.decided ? 1 : 0}${c.analytics ? 1 : 0}${c.marketing ? 1 : 0}`;
}

function parseKey(key: string): ConsentState {
  return { decided: key[0] === "1", analytics: key[1] === "1", marketing: key[2] === "1" };
}

/**
 * Third-party measurement tags, mounted once in the root layout.
 *
 *  - GA4 loads only after the visitor allowed analytics cookies, the Meta
 *    Pixel only after they allowed marketing cookies (`getConsent` /
 *    `onConsentChange`, so a decision in the banner, the settings dialog or
 *    another tab applies at once). Nothing is requested before that.
 *  - Withdrawing consent switches the tags off immediately (GA4 opt-out flag
 *    and consent mode, Pixel consent revoke); the consent manager deletes
 *    their cookies.
 *  - A `page_view` is sent on the first allowed page and on every client-side
 *    navigation, with tokens and personal data removed from the address.
 *  - App events go through `track()` from `./tracking-client`.
 */
export function TrackingScripts({ ga4Id, metaPixelId }: TrackingScriptsProps) {
  const ga4 = ga4Id ? normalizeGa4Id(ga4Id) || undefined : undefined;
  const pixel = metaPixelId ? normalizeMetaPixelId(metaPixelId) || undefined : undefined;
  const key = useSyncExternalStore(onConsentChange, consentKey, () => "000");
  const consent = key === "000" ? UNDECIDED : parseKey(key);
  const gaOn = !!ga4 && consent.analytics;
  const pixelOn = !!pixel && consent.marketing;

  useEffect(() => {
    if (ga4) {
      if (gaOn) installGa4(ga4, consent.marketing);
      else disableGa4(ga4);
    }
    if (pixel) {
      if (pixelOn) installMetaPixel(pixel);
      else disableMetaPixel();
    }
    setTrackingState({ ga4Id: ga4, metaPixelId: pixel, analytics: consent.analytics, marketing: consent.marketing });
  }, [ga4, pixel, gaOn, pixelOn, consent.analytics, consent.marketing]);

  if (!ga4 && !pixel) return null;
  return (
    <>
      {gaOn && <Script id="ll-ga4" src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4!)}`} strategy="afterInteractive" />}
      {pixelOn && <Script id="ll-meta-pixel" src="https://connect.facebook.net/en_US/fbevents.js" strategy="afterInteractive" />}
      {(gaOn || pixelOn) && (
        <Suspense fallback={null}>
          <PageViews enabledKey={`${gaOn ? 1 : 0}${pixelOn ? 1 : 0}`} />
        </Suspense>
      )}
    </>
  );
}

/** One `page_view` per address (and again when another tag becomes allowed). */
function PageViews({ enabledKey }: { enabledKey: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const last = useRef("");

  useEffect(() => {
    const id = `${enabledKey}|${pathname}?${search}`;
    if (last.current === id) return;
    // Let the new page's <title> land before reading it.
    const timer = window.setTimeout(() => {
      last.current = id;
      track("page_view", { page_location: trackingUrl(window.location.href), page_title: document.title });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [enabledKey, pathname, search]);

  return null;
}

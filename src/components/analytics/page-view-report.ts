import { funnelStageOf } from "@/lib/growth/analytics-shared";

/**
 * What `<PageViewBeacon />` sends for a page (growth area), kept apart from
 * the component so the rules can be tested without a browser.
 *
 * Only the path is sent (the query string never leaves the page), plus, on
 * the first page of a visit, the referring site's origin and the UTM tags.
 * The current analytics-consent decision goes along: without consent the
 * server stores the page view without any visitor or member id, so the
 * body also says when this tab reaches a funnel stage (a product page, a
 * checkout) for the first time, letting the funnel count such a visitor once
 * per stage.
 */

/** What the browser knows when a page is shown. */
export interface PageViewEnvironment {
  /** Do-Not-Track or Global Privacy Control is on. */
  trackingRefused: boolean;
  /** The visitor accepted analytics cookies. */
  consent: boolean;
  /** The document was loaded by a fresh navigation (not a reload or back/forward). */
  freshNavigation: boolean;
  /** `document.referrer` ("" for none). */
  documentReferrer: string;
  /** `window.location.host`. */
  host: string;
  /** `window.location.search`. */
  search: string;
  /** True the first time this tab reaches `stage` (and remembers it). */
  firstTimeAt(stage: string): boolean;
}

/** Origin of an external referrer ("" for none or this site). */
function externalReferrer(documentReferrer: string, host: string): string {
  if (!documentReferrer) return "";
  try {
    const url = new URL(documentReferrer);
    return url.host === host ? "" : url.origin;
  } catch {
    return "";
  }
}

export type PageViewReporter = (pathname: string, env: PageViewEnvironment) => Record<string, unknown> | null;

/**
 * A reporter for one document. Only its first page can be the entry of a
 * visit (with the referrer and campaign tags); every later call is a page of
 * the same visit, whichever component asks. Returns the body to send, or
 * null when nothing may be sent.
 */
export function createPageViewReporter(): PageViewReporter {
  let documentViewSent = false;
  return (pathname, env) => {
    const first = !documentViewSent;
    documentViewSent = true;
    if (env.trackingRefused) return null;

    const referrer = first ? externalReferrer(env.documentReferrer, env.host) : "";
    const sameSiteReferrer = first && !!env.documentReferrer && !referrer;
    const entry = first && env.freshNavigation && !sameSiteReferrer;
    const body: Record<string, unknown> = { path: pathname, consent: env.consent, entry };
    if (entry) {
      if (referrer) body.referrer = referrer;
      const params = new URLSearchParams(env.search);
      const utm = { source: params.get("utm_source") ?? undefined, medium: params.get("utm_medium") ?? undefined, campaign: params.get("utm_campaign") ?? undefined };
      if (utm.source || utm.medium || utm.campaign) body.utm = utm;
    }
    const stage = funnelStageOf(pathname);
    if (stage && env.firstTimeAt(stage)) body.firstReach = true;
    return body;
  };
}

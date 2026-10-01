import { type TrackParams, ga4Params, metaPixelEvent } from "@/lib/seo/tracking";

/**
 * Browser side of the measurement tags. `TrackingScripts` (root layout)
 * tells this module which tags are configured and what the visitor agreed
 * to; `track(event, params)` then forwards app events to GA4 (analytics
 * consent) and the Meta Pixel (marketing consent). Without consent an event
 * goes nowhere. Events fired before the consent state is known (a page's
 * effect can run before the layout's) wait in a short queue.
 */

type CommandFn = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; push?: unknown; loaded?: boolean; version?: string };

interface TrackingWindow {
  dataLayer?: unknown[];
  gtag?: CommandFn;
  fbq?: CommandFn;
  _fbq?: CommandFn;
  [disable: `ga-disable-${string}`]: boolean | undefined;
}

export interface TrackingState {
  ga4Id?: string;
  metaPixelId?: string;
  analytics: boolean;
  marketing: boolean;
}

let state: TrackingState | null = null;
const pending: { event: string; params: TrackParams; onceKey?: string }[] = [];
const MAX_PENDING = 20;
const ONCE_PREFIX = "ll_tracked:";

function win(): TrackingWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as TrackingWindow);
}

function gaActive(s: TrackingState | null): s is TrackingState & { ga4Id: string } {
  return !!s?.ga4Id && s.analytics;
}

function pixelActive(s: TrackingState | null): s is TrackingState & { metaPixelId: string } {
  return !!s?.metaPixelId && s.marketing;
}

function alreadySent(key: string): boolean {
  try {
    return window.localStorage.getItem(ONCE_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function markSent(key: string): void {
  try {
    window.localStorage.setItem(ONCE_PREFIX + key, "1");
  } catch {
    // Storage unavailable (private mode): the event may be sent again on reload.
  }
}

function dispatch(event: string, params: TrackParams, onceKey?: string): void {
  const w = win();
  if (!w || !state) return;
  if (onceKey && alreadySent(onceKey)) return;
  let sent = false;
  if (gaActive(state) && w.gtag) {
    w.gtag("event", event, ga4Params(params));
    sent = true;
  }
  if (pixelActive(state) && w.fbq) {
    const call = metaPixelEvent(event, params);
    if (call.method === "track" && call.name === "Purchase" && typeof params.transaction_id === "string") {
      w.fbq("track", call.name, call.params, { eventID: params.transaction_id });
    } else {
      w.fbq(call.method, call.name, call.params);
    }
    sent = true;
  }
  if (sent && onceKey) markSent(onceKey);
}

/**
 * Send an app event (GA4 recommended names: `generate_lead`, `purchase`,
 * `sign_up`, …) to every tag the visitor consented to. With `onceKey` the
 * event is sent at most once per browser (e.g. one `purchase` per order,
 * even when the success page is reloaded).
 */
export function track(event: string, params: TrackParams = {}, onceKey?: string): void {
  if (!win()) return;
  if (!state) {
    if (pending.length < MAX_PENDING) pending.push({ event, params, onceKey });
    return;
  }
  dispatch(event, params, onceKey);
}

/** Whether any tag is loaded and allowed (used to skip work such as page-view bookkeeping). */
export function trackingActive(): boolean {
  return gaActive(state) || pixelActive(state);
}

/** Define the GA4 command queue before gtag.js loads (gtag.js reads `arguments` objects from dataLayer). */
export function installGa4(id: string, marketing: boolean): void {
  const w = win();
  if (!w) return;
  w[`ga-disable-${id}`] = false;
  if (!w.gtag) {
    w.dataLayer = w.dataLayer ?? [];
    const layer = w.dataLayer;
    w.gtag = function gtag() {
      // gtag.js requires the Arguments object itself, not an array copy.
      // eslint-disable-next-line prefer-rest-params
      layer.push(arguments);
    };
    w.gtag("consent", "default", consentMode(true, marketing));
    w.gtag("js", new Date());
    w.gtag("config", id, { send_page_view: false });
  } else {
    w.gtag("consent", "update", consentMode(true, marketing));
  }
}

/** Stop GA4 after consent is withdrawn (the script stays in memory but sends nothing). */
export function disableGa4(id: string): void {
  const w = win();
  if (!w) return;
  w[`ga-disable-${id}`] = true;
  w.gtag?.("consent", "update", consentMode(false, false));
}

function consentMode(analytics: boolean, marketing: boolean): Record<string, "granted" | "denied"> {
  const ads = marketing ? "granted" : "denied";
  return { analytics_storage: analytics ? "granted" : "denied", ad_storage: ads, ad_user_data: ads, ad_personalization: ads };
}

/** Define the Meta Pixel command queue before fbevents.js loads (the standard base code, without the script tag). */
export function installMetaPixel(id: string): void {
  const w = win();
  if (!w) return;
  if (!w.fbq) {
    const fbq = ((...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    }) as CommandFn;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    w.fbq = fbq;
    w._fbq = fbq;
    fbq("init", id);
  } else {
    w.fbq("consent", "grant");
  }
}

export function disableMetaPixel(): void {
  win()?.fbq?.("consent", "revoke");
}

/** Called by `TrackingScripts` whenever the configuration or the consent changes. */
export function setTrackingState(next: TrackingState): void {
  state = next;
  const queued = pending.splice(0);
  for (const item of queued) dispatch(item.event, item.params, item.onceKey);
}

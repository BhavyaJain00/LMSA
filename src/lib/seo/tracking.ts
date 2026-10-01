/**
 * Measurement tags (GA4, Meta Pixel), pure and isomorphic: id validation for
 * the settings form, the page address that may be sent to a tag (secrets and
 * personal data in query strings stripped), and how app events map onto each
 * provider's event names and parameters.
 */

/** "G-XXXXXXX" (GA4 measurement id). */
export function normalizeGa4Id(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  if (!value) return "";
  return /^G-[A-Z0-9]{4,20}$/.test(value) ? value : null;
}

/** Numeric Meta Pixel id (dataset id). */
export function normalizeMetaPixelId(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "";
  return /^\d{6,20}$/.test(value) ? value : null;
}

export function parseTrackingSettings(input: { ga4Id: string; metaPixelId: string }): { patch: { ga4Id?: string; metaPixelId?: string }; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const ga4 = normalizeGa4Id(input.ga4Id);
  const pixel = normalizeMetaPixelId(input.metaPixelId);
  if (ga4 === null) errors.ga4Id = "Enter a GA4 measurement ID such as G-AB12CD34EF (Admin → Data streams in Google Analytics).";
  if (pixel === null) errors.metaPixelId = "Enter the numeric Pixel ID from Meta Events Manager.";
  return { errors, patch: { ga4Id: ga4 || undefined, metaPixelId: pixel || undefined } };
}

/** Paths whose query string carries secrets (sign-in, password reset, signed links): never sent to a tag. */
const PRIVATE_QUERY_PATHS = ["/free/confirm", "/free/unsubscribe", "/reset-password", "/verify-email", "/two-factor", "/login", "/register", "/api/", "/gift/", "/invite/"];
/** Query parameters dropped everywhere (tokens, codes, emails). Marketing params (utm_*, gclid, fbclid) are kept. */
const PRIVATE_PARAMS = /^(t|e|l|token|code|key|secret|signature|sig|email|password|session|next|redirect|ref_token)$/i;

/** The address to report for a page view, without secrets or personal data. */
export function trackingUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "";
  }
  url.hash = "";
  if (PRIVATE_QUERY_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p.endsWith("/") ? p : `${p}/`))) {
    url.search = "";
    return url.toString();
  }
  for (const name of [...url.searchParams.keys()]) {
    if (PRIVATE_PARAMS.test(name)) url.searchParams.delete(name);
  }
  return url.toString();
}

export type TrackParams = Record<string, string | number | boolean | undefined | TrackItem[]>;

export interface TrackItem {
  item_id: string;
  item_name: string;
  item_category?: string;
  price?: number;
  quantity?: number;
}

/** Events the app fires itself (GA4 recommended names). */
export type AppEvent = "page_view" | "generate_lead" | "purchase" | "begin_checkout" | "sign_up" | "view_item" | (string & {});

const META_STANDARD: Record<string, string> = {
  page_view: "PageView",
  generate_lead: "Lead",
  purchase: "Purchase",
  begin_checkout: "InitiateCheckout",
  sign_up: "CompleteRegistration",
  view_item: "ViewContent",
};

/** Meta Pixel call for an app event: standard events with `track`, everything else with `trackCustom`. */
export function metaPixelEvent(event: string, params: TrackParams = {}): { method: "track" | "trackCustom"; name: string; params: Record<string, unknown> } {
  const name = META_STANDARD[event];
  const out: Record<string, unknown> = {};
  if (typeof params.value === "number") out.value = params.value;
  if (typeof params.currency === "string") out.currency = params.currency;
  const items = Array.isArray(params.items) ? params.items : [];
  if (items.length) {
    out.content_ids = items.map((i) => i.item_id);
    out.content_type = "product";
    out.contents = items.map((i) => ({ id: i.item_id, quantity: i.quantity ?? 1 }));
    out.num_items = items.reduce((n, i) => n + (i.quantity ?? 1), 0);
  }
  if (typeof params.source === "string") out.content_category = params.source;
  if (name) return { method: "track", name, params: out };
  const custom = event.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40) || "custom_event";
  const passthrough = Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean"));
  return { method: "trackCustom", name: custom, params: { ...passthrough, ...out } };
}

/** GA4 event parameters: undefined values dropped, strings capped at 100 characters (GA4's limit). */
export function ga4Params(params: TrackParams = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = typeof value === "string" ? value.slice(0, 100) : value;
  }
  return out;
}

/** `purchase` parameters for an order (amounts are stored in the smallest currency unit). */
export function purchaseEventParams(order: { orderId: string; amount: number; currency: string; taxAmount?: number; couponCode?: string; itemType: string; itemId: string; itemTitle: string }): TrackParams {
  const value = Math.round(order.amount) / 100;
  return {
    transaction_id: order.orderId,
    value,
    currency: order.currency.toUpperCase(),
    tax: order.taxAmount ? Math.round(order.taxAmount) / 100 : undefined,
    coupon: order.couponCode || undefined,
    items: [{ item_id: `${order.itemType}:${order.itemId}`, item_name: order.itemTitle, item_category: order.itemType, price: value, quantity: 1 }],
  };
}

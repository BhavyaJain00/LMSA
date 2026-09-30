import type { WebhookDelivery } from "@/lib/types";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { isWebhookEventName, webhookEventLabel } from "./events";
import { MAX_DELIVERY_ATTEMPTS } from "./policy";
import { isManualDelivery } from "./types";

/**
 * Reading the delivery log: filters, counters and the CSV export shared by
 * the admin pages and the REST API. Pure module.
 */

export const DELIVERY_STATUSES = ["pending", "success", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Retrying",
  success: "Delivered",
  failed: "Failed",
};

/** Rows per page of the delivery log in the admin. */
export const DELIVERY_PAGE_SIZE = 25;

export interface DeliveryFilter {
  /** "" for every status. */
  status: DeliveryStatus | "";
  /** "" for every event. */
  event: string;
  /** Free text: event id, delivery id, response status, error text. */
  q: string;
  /** "test" only tests, "live" only real events, "" both. */
  kind: "test" | "live" | "";
}

export const NO_DELIVERY_FILTER: DeliveryFilter = { status: "", event: "", q: "", kind: "" };

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function param(input: ParamSource, key: string): string {
  const raw = input instanceof URLSearchParams ? input.get(key) : input[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

/** Filter values from a query string; anything unknown means "no filter". */
export function parseDeliveryFilter(input: ParamSource): DeliveryFilter {
  const status = param(input, "status");
  const event = param(input, "event");
  const kind = param(input, "kind");
  return {
    status: (DELIVERY_STATUSES as readonly string[]).includes(status) ? (status as DeliveryStatus) : "",
    event: isWebhookEventName(event) ? event : "",
    q: param(input, "q"),
    kind: kind === "test" || kind === "live" ? kind : "",
  };
}

export function deliveryFilterQuery(filter: DeliveryFilter): Record<string, string | undefined> {
  return { status: filter.status || undefined, event: filter.event || undefined, q: filter.q || undefined, kind: filter.kind || undefined };
}

export function isDeliveryFilterActive(filter: DeliveryFilter): boolean {
  return !!(filter.status || filter.event || filter.q || filter.kind);
}

/** Deliveries of one endpoint matching the filter, newest first. */
export function filterDeliveries(deliveries: readonly WebhookDelivery[], endpointId: string, filter: DeliveryFilter = NO_DELIVERY_FILTER): WebhookDelivery[] {
  const needle = filter.q.toLowerCase();
  return deliveries
    .filter((d) => {
      if (d.endpointId !== endpointId) return false;
      if (filter.status && d.status !== filter.status) return false;
      if (filter.event && d.event !== filter.event) return false;
      if (filter.kind === "test" && !d.test) return false;
      if (filter.kind === "live" && d.test) return false;
      if (!needle) return true;
      return `${d.id} ${d.eventId ?? ""} ${d.event} ${d.responseStatus ?? ""} ${d.lastError ?? ""} ${d.resentFromId ?? ""}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export interface DeliveryStats {
  total: number;
  pending: number;
  /** Finished deliveries created in the last 24 hours (tests excluded). */
  delivered24h: number;
  failed24h: number;
  /** Finished deliveries created in the last 7 days (tests excluded). */
  delivered7d: number;
  failed7d: number;
  /** Share of finished deliveries of the last 7 days that succeeded (0-100), or null when there were none. */
  successRate7d: number | null;
  /** Median duration of successful attempts in the last 7 days, in ms (null when there were none). */
  medianMs7d: number | null;
}

const DAY_MS = 86_400_000;

const NO_DELIVERIES: DeliveryStats = { total: 0, pending: 0, delivered24h: 0, failed24h: 0, delivered7d: 0, failed7d: 0, successRate7d: null, medianMs7d: null };

/** Counters per endpoint id, in one pass over the log. */
export function deliveryStatsByEndpoint(deliveries: readonly WebhookDelivery[], now: number = Date.now()): Map<string, DeliveryStats> {
  const working = new Map<string, DeliveryStats & { durations: number[] }>();
  for (const delivery of deliveries) {
    let stats = working.get(delivery.endpointId);
    if (!stats) working.set(delivery.endpointId, (stats = { ...NO_DELIVERIES, durations: [] }));
    stats.total++;
    if (delivery.status === "pending") {
      stats.pending++;
      continue;
    }
    if (delivery.test) continue;
    const age = now - Date.parse(delivery.createdAt);
    if (!(age < 7 * DAY_MS)) continue;
    const recent = age < DAY_MS;
    if (delivery.status === "success") {
      stats.delivered7d++;
      if (recent) stats.delivered24h++;
      if (typeof delivery.durationMs === "number") stats.durations.push(delivery.durationMs);
    } else {
      stats.failed7d++;
      if (recent) stats.failed24h++;
    }
  }
  const out = new Map<string, DeliveryStats>();
  for (const [endpointId, { durations, ...stats }] of working) {
    const finished = stats.delivered7d + stats.failed7d;
    stats.successRate7d = finished ? Math.round((stats.delivered7d / finished) * 100) : null;
    if (durations.length) {
      durations.sort((a, b) => a - b);
      stats.medianMs7d = durations[Math.floor((durations.length - 1) / 2)]!;
    }
    out.set(endpointId, stats);
  }
  return out;
}

/** Counters of one endpoint (all zero when it has no deliveries). */
export function deliveryStats(deliveries: readonly WebhookDelivery[], endpointId: string, now: number = Date.now()): DeliveryStats {
  return deliveryStatsByEndpoint(deliveries, now).get(endpointId) ?? { ...NO_DELIVERIES };
}

/** "Attempt 3 of 8", or "1 attempt" for deliveries made by hand. */
export function describeAttempts(delivery: Pick<WebhookDelivery, "attempts" | "test" | "resentFromId" | "status">): string {
  if (isManualDelivery(delivery)) return delivery.attempts === 1 ? "1 attempt" : `${delivery.attempts} attempts`;
  if (delivery.status === "success") return delivery.attempts === 1 ? "First attempt" : `Attempt ${delivery.attempts} of ${MAX_DELIVERY_ATTEMPTS}`;
  return `${delivery.attempts} of ${MAX_DELIVERY_ATTEMPTS} attempts`;
}

/** CSV (with a header row) of deliveries for spreadsheets. */
export function deliveriesToCsv(deliveries: readonly WebhookDelivery[]): string {
  const header = ["Created (UTC)", "Delivery id", "Event", "Event name", "Event id", "Kind", "Status", "Attempts", "HTTP status", "Duration (ms)", "Last attempt (UTC)", "Delivered (UTC)", "Next attempt (UTC)", "Error", "Response body"];
  const rows = deliveries.map((d) => [
    d.createdAt,
    d.id,
    d.event,
    webhookEventLabel(d.event),
    d.eventId ?? "",
    d.test ? "test" : d.resentFromId ? "resend" : "event",
    DELIVERY_STATUS_LABELS[d.status],
    String(d.attempts),
    d.responseStatus === undefined ? "" : String(d.responseStatus),
    d.durationMs === undefined ? "" : String(d.durationMs),
    d.lastAttemptAt ?? "",
    d.deliveredAt ?? "",
    d.nextAttemptAt ?? "",
    d.lastError ?? "",
    d.responseBody ?? "",
  ]);
  // Formula-looking cells (response bodies are outside text) are neutralized by `toCsv`.
  return toCsv([header, ...rows]);
}

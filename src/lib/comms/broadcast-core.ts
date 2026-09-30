/**
 * Broadcasts: the pure rules — send throttle, schedule validation, phases,
 * progress and rates, list filtering and the CSV export.
 *
 * A broadcast moves draft → (scheduled →) sending → sent. While it is
 * "sending", the recipient list captured at the start sits in `pending` and
 * is handed to the email outbox in batches, at most `ratePerMinute` emails
 * per minute; it can be paused, resumed or stopped.
 */
import type { Broadcast } from "@/lib/types";
import { ratePercent } from "./tracking-core";

declare module "@/lib/types" {
  interface Broadcast {
    /** Round 3 comms: inbox preview text shown after the subject. */
    preheader?: string;
    /** Emails handed to the outbox per minute while sending. */
    ratePerMinute?: number;
    /** When sending started. */
    startedAt?: string;
    /** Recipients still to be queued ("m:<userId>" / "l:<leadId>"), in send order. Removed once the send finishes. */
    pending?: string[];
    /** Emails handed to the outbox so far. */
    queued?: number;
    /** Recipients dropped at send time (unsubscribed, disabled or removed after the list was built). */
    skipped?: number;
    /** Emails accepted by the mail server. */
    delivered?: number;
    /** Emails that could not be delivered. */
    failed?: number;
    /** Recipients who unsubscribed after this broadcast. */
    unsubscribes?: number;
    /** Start of the current throttle minute and the emails queued in it. */
    windowStartedAt?: string;
    windowCount?: number;
    /** Set while a send is paused (status stays "sending"). */
    pausedAt?: string;
    /** Set when a send was stopped before everyone was queued (status "sent"). */
    canceledAt?: string;
  }
}

/* ------------------------------------------------------------------ */
/* Throttle                                                            */
/* ------------------------------------------------------------------ */

export const RATE_OPTIONS = [30, 60, 120, 300, 600] as const;
export const DEFAULT_RATE_PER_MINUTE = 120;
/** Emails rendered and queued in one write. */
export const MAX_BATCH_SIZE = 100;
const WINDOW_MS = 60_000;

export function normalizeRate(value: unknown): number {
  const n = Math.floor(Number(value));
  return (RATE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_RATE_PER_MINUTE;
}

export interface ThrottleAllowance {
  /** Emails that may be queued right now. */
  allowance: number;
  /** The throttle minute this allowance belongs to, and what was already queued in it. */
  windowStartedAt: number;
  windowCount: number;
  /** When the next minute starts (more capacity). */
  nextAt: number;
}

/**
 * Fixed one-minute windows: at most `ratePerMinute` emails are queued in a
 * window, and a new window opens 60 seconds after the current one started.
 */
export function throttleAllowance(state: Pick<Broadcast, "ratePerMinute" | "windowStartedAt" | "windowCount">, now: number): ThrottleAllowance {
  const rate = normalizeRate(state.ratePerMinute);
  const started = state.windowStartedAt ? Date.parse(state.windowStartedAt) : NaN;
  // A window from the future (clock change) is treated as expired.
  if (Number.isNaN(started) || now - started >= WINDOW_MS || started > now) {
    return { allowance: rate, windowStartedAt: now, windowCount: 0, nextAt: now + WINDOW_MS };
  }
  const used = Math.max(0, Math.floor(state.windowCount ?? 0));
  return { allowance: Math.max(0, rate - used), windowStartedAt: started, windowCount: used, nextAt: started + WINDOW_MS };
}

/** Minutes a send of `recipients` emails takes at `ratePerMinute` (at least 1). */
export function estimateSendMinutes(recipients: number, ratePerMinute: number | undefined): number {
  return Math.max(1, Math.ceil(Math.max(0, recipients) / normalizeRate(ratePerMinute)));
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

/** A schedule must be at least this far ahead (anything sooner is "send now"). */
export const MIN_SCHEDULE_LEAD_MS = 60_000;
export const MAX_SCHEDULE_AHEAD_MS = 366 * 86_400_000;

export function parseScheduleTime(raw: unknown, now: number): { ok: true; at: string } | { ok: false; error: string } {
  const at = typeof raw === "string" && raw.trim() ? Date.parse(raw.trim()) : NaN;
  if (Number.isNaN(at)) return { ok: false, error: "Choose a date and time." };
  if (at < now + MIN_SCHEDULE_LEAD_MS) return { ok: false, error: "Choose a time at least a minute from now, or send the broadcast right away." };
  if (at > now + MAX_SCHEDULE_AHEAD_MS) return { ok: false, error: "Choose a time within the next 12 months." };
  return { ok: true, at: new Date(at).toISOString() };
}

/* ------------------------------------------------------------------ */
/* Phases, progress and rates                                          */
/* ------------------------------------------------------------------ */

export type BroadcastPhase = "draft" | "scheduled" | "sending" | "paused" | "sent" | "stopped";

export const PHASE_LABELS: Record<BroadcastPhase, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  paused: "Paused",
  sent: "Sent",
  stopped: "Stopped",
};

export function broadcastPhase(b: Pick<Broadcast, "status" | "pausedAt" | "canceledAt">): BroadcastPhase {
  if (b.status === "sending") return b.pausedAt ? "paused" : "sending";
  if (b.status === "sent") return b.canceledAt ? "stopped" : "sent";
  return b.status;
}

/** Content and audience can still change. */
export function isEditable(b: Pick<Broadcast, "status">): boolean {
  return b.status === "draft" || b.status === "scheduled";
}

export interface SendProgress {
  total: number;
  /** Recipients handled so far (queued or skipped). */
  done: number;
  remaining: number;
  percent: number;
}

export function sendProgress(b: Pick<Broadcast, "recipients" | "queued" | "skipped" | "pending" | "status">): SendProgress {
  const total = Math.max(0, b.recipients);
  const remaining = b.status === "sending" ? Math.min(total, b.pending?.length ?? 0) : 0;
  const done = b.status === "sending" ? total - remaining : Math.min(total, (b.queued ?? 0) + (b.skipped ?? 0));
  return { total, done, remaining, percent: total ? Math.round((done / total) * 100) : b.status === "sent" ? 100 : 0 };
}

export interface BroadcastRates {
  /** Emails handed to the outbox. */
  queued: number;
  delivered: number;
  failed: number;
  /** Percentages with one decimal, of delivered emails (of queued ones while nothing is confirmed yet). */
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  unsubscribeRate: number;
}

export function broadcastRates(b: Pick<Broadcast, "queued" | "delivered" | "failed" | "opens" | "clicks" | "unsubscribes">): BroadcastRates {
  const queued = b.queued ?? 0;
  const delivered = b.delivered ?? 0;
  const base = delivered || queued;
  return {
    queued,
    delivered,
    failed: b.failed ?? 0,
    openRate: ratePercent(b.opens ?? 0, base),
    clickRate: ratePercent(b.clicks ?? 0, base),
    clickToOpenRate: ratePercent(b.clicks ?? 0, b.opens ?? 0),
    unsubscribeRate: ratePercent(b.unsubscribes ?? 0, base),
  };
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export const BROADCAST_STATUS_FILTERS = ["all", "draft", "scheduled", "sending", "sent"] as const;
export type BroadcastStatusFilter = (typeof BROADCAST_STATUS_FILTERS)[number];

export interface BroadcastListFilters {
  status: BroadcastStatusFilter;
  q: string;
  page: number;
}

export const BROADCASTS_PAGE_SIZE = 20;

export function parseBroadcastFilters(params: Record<string, string | string[] | undefined>): BroadcastListFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = first(params.status);
  const page = Math.floor(Number(first(params.page)));
  return {
    status: (BROADCAST_STATUS_FILTERS as readonly string[]).includes(status) ? (status as BroadcastStatusFilter) : "all",
    q: first(params.q).trim().slice(0, 120),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

/** When the broadcast last mattered: sent, started, scheduled or edited. */
export function broadcastSortTime(b: Pick<Broadcast, "status" | "sentAt" | "startedAt" | "scheduledAt" | "updatedAt">): string {
  if (b.status === "sent") return b.sentAt ?? b.updatedAt;
  if (b.status === "sending") return b.startedAt ?? b.updatedAt;
  return b.updatedAt;
}

/** Matching broadcasts: the ones being sent first, then the most recent. */
export function filterBroadcasts<B extends Pick<Broadcast, "status" | "subject" | "body" | "sentAt" | "startedAt" | "scheduledAt" | "updatedAt">>(
  list: readonly B[],
  filters: Pick<BroadcastListFilters, "status" | "q">,
): B[] {
  const q = filters.q.toLowerCase();
  return list
    .filter((b) => (filters.status === "all" || b.status === filters.status) && (!q || b.subject.toLowerCase().includes(q) || b.body.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.status === "sending") - Number(a.status === "sending") || broadcastSortTime(b).localeCompare(broadcastSortTime(a)));
}

export const BROADCAST_CSV_HEADER = [
  "Subject",
  "Status",
  "Created by",
  "Scheduled for (UTC)",
  "Started (UTC)",
  "Finished (UTC)",
  "Recipients",
  "Queued",
  "Skipped",
  "Delivered",
  "Failed",
  "Unique opens",
  "Open rate %",
  "Unique clicks",
  "Click rate %",
  "Unsubscribes",
];

export function broadcastCsvRows(list: readonly Broadcast[], authorName: (userId: string) => string): string[][] {
  return [
    BROADCAST_CSV_HEADER,
    ...list.map((b) => {
      const rates = broadcastRates(b);
      return [
        b.subject,
        PHASE_LABELS[broadcastPhase(b)],
        authorName(b.createdById),
        b.scheduledAt ?? "",
        b.startedAt ?? "",
        b.sentAt ?? "",
        String(b.recipients),
        String(rates.queued),
        String(b.skipped ?? 0),
        String(rates.delivered),
        String(rates.failed),
        String(b.opens ?? 0),
        String(rates.openRate),
        String(b.clicks ?? 0),
        String(rates.clickRate),
        String(b.unsubscribes ?? 0),
      ];
    }),
  ];
}

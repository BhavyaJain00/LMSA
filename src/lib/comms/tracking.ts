import "server-only";
import { createHmac } from "node:crypto";
import type { Database, EmailEvent, EmailMessage } from "@/lib/types";
import { getAppSecret } from "@/lib/server-env";
import { siteConfig } from "@/lib/config";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import {
  applyTracking,
  parsePixelParam,
  parseTrackingId,
  planTrackingEvents,
  summarizeEvents,
  verifyClickSignature,
  verifyOpenSignature,
  type EventSummary,
  type LinkStats,
  type TrackingHit,
  type TrackingPlan,
} from "./tracking-core";

/**
 * Email open/click tracking on the server: the signing key, injection into
 * outbox messages (called by `enqueueEmail` when a message asks for
 * tracking), verification for the `/api/email/o` and `/api/email/c` routes,
 * recording `EmailEvent`s, and the reports on `/admin/broadcasts/tracking`.
 *
 * Unique opens and clicks of a broadcast are also counted on the
 * `Broadcast` row itself (`opens`, `clicks`) at the moment they happen, so
 * list pages don't have to scan every event.
 */

/** Tracking signatures use their own sub-key of APP_SECRET. */
function trackingKey(): Buffer {
  return createHmac("sha256", getAppSecret()).update("learnloop:email-tracking:v1").digest();
}

/** Add the open pixel and/or click redirects to a rendered email for outbox message `emailId`. */
export function addEmailTracking(html: string, emailId: string, opts: { opens: boolean; clicks: boolean }): string {
  if (!opts.opens && !opts.clicks) return html;
  return applyTracking(html, { baseUrl: siteConfig.appUrl, key: trackingKey(), emailId, opens: opts.opens, clicks: opts.clicks });
}

/** Email id of a valid pixel route parameter (`<emailId>.<sig>.gif`), else null. */
export function verifyPixelParam(param: string | null | undefined): string | null {
  const parsed = parsePixelParam(param);
  if (!parsed) return null;
  return verifyOpenSignature(trackingKey(), parsed.emailId, parsed.signature) ? parsed.emailId : null;
}

/** Whether `url` is exactly the destination signed for this email. */
export function verifyClickParams(emailId: string | null | undefined, url: string | null | undefined, signature: string | null | undefined): boolean {
  return verifyClickSignature(trackingKey(), emailId, url, signature);
}

/**
 * Store the events for one open or click (deduplicated, see
 * `planTrackingEvents`) and update the broadcast counters. Returns the plan
 * that was applied, or null when the email no longer exists.
 */
export async function recordEmailHit(emailId: string, hit: TrackingHit, now: number = Date.now()): Promise<TrackingPlan | null> {
  return mutate((db) => {
    const email = db.emails.find((e) => e.id === emailId);
    if (!email) return null;
    const existing = db.emailEvents.filter((e) => e.emailId === emailId);
    const plan = planTrackingEvents(existing, hit, now);
    if (!plan.add.length) return plan;
    const createdAt = new Date(now).toISOString();
    for (const add of plan.add) {
      const event: EmailEvent = { id: uid("eev"), emailId, type: add.type, createdAt };
      if (add.url) event.url = add.url;
      db.emailEvents.push(event);
    }
    const ref = parseTrackingId(email.trackingId);
    if (ref?.kind === "broadcast" && (plan.firstOpen || plan.firstClick)) {
      const broadcast = db.broadcasts.find((b) => b.id === ref.broadcastId);
      if (broadcast) {
        if (plan.firstOpen) broadcast.opens = (broadcast.opens ?? 0) + 1;
        if (plan.firstClick) broadcast.clicks = (broadcast.clicks ?? 0) + 1;
      }
    }
    return plan;
  });
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export const TRACKING_RANGES = [7, 30, 90, 365] as const;
export type TrackingRange = (typeof TRACKING_RANGES)[number];

export function parseTrackingRange(value: unknown): TrackingRange {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (TRACKING_RANGES as readonly number[]).includes(n) ? (n as TrackingRange) : 30;
}

export interface CampaignLabel {
  /** Group key: "broadcast:<id>" or "sequence:<id>". */
  key: string;
  kind: "broadcast" | "sequence" | "other";
  label: string;
  href?: string;
}

/** Readable name of the campaign an outbox row belongs to. */
export function campaignLabel(db: Pick<Database, "broadcasts" | "emailSequences">, trackingId: string | undefined): CampaignLabel {
  const ref = parseTrackingId(trackingId);
  if (ref?.kind === "broadcast") {
    const b = db.broadcasts.find((x) => x.id === ref.broadcastId);
    return { key: `broadcast:${ref.broadcastId}`, kind: "broadcast", label: b ? b.subject : "Deleted broadcast", href: b ? `/admin/broadcasts/${b.id}` : undefined };
  }
  if (ref?.kind === "sequence") {
    const s = db.emailSequences.find((x) => x.id === ref.sequenceId);
    return { key: `sequence:${ref.sequenceId}`, kind: "sequence", label: s ? s.name : "Deleted sequence", href: s ? `/admin/sequences/${s.id}` : undefined };
  }
  return { key: "other", kind: "other", label: "Other tracked emails" };
}

export interface CampaignStats extends CampaignLabel {
  sent: number;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
}

export interface TrackingOverview {
  rangeDays: TrackingRange;
  since: string;
  /** Tracked emails created in the range. */
  tracked: number;
  delivered: number;
  failed: number;
  summary: EventSummary;
  campaigns: CampaignStats[];
  topLinks: LinkStats[];
}

function trackedEmailsSince(db: Database, since: string): EmailMessage[] {
  return db.emails.filter((e) => !!e.trackingId && e.createdAt >= since);
}

function eventsByEmail(events: readonly EmailEvent[], ids: ReadonlySet<string>): Map<string, EmailEvent[]> {
  const out = new Map<string, EmailEvent[]>();
  for (const e of events) {
    if (!ids.has(e.emailId)) continue;
    const list = out.get(e.emailId);
    if (list) list.push(e);
    else out.set(e.emailId, [e]);
  }
  return out;
}

export async function getTrackingOverview(rangeDays: TrackingRange, now: number = Date.now()): Promise<TrackingOverview> {
  const db = await getDb();
  const since = new Date(now - rangeDays * 86_400_000).toISOString();
  const emails = trackedEmailsSince(db, since);
  const byEmail = eventsByEmail(db.emailEvents, new Set(emails.map((e) => e.id)));
  const events = [...byEmail.values()].flat();
  const summary = summarizeEvents(events);

  const groups = new Map<string, CampaignStats>();
  for (const email of emails) {
    const label = campaignLabel(db, email.trackingId);
    const row = groups.get(label.key) ?? { ...label, sent: 0, delivered: 0, uniqueOpens: 0, uniqueClicks: 0 };
    row.sent++;
    if (email.status === "sent") row.delivered++;
    const own = byEmail.get(email.id) ?? [];
    if (own.some((e) => e.type === "open")) row.uniqueOpens++;
    if (own.some((e) => e.type === "click")) row.uniqueClicks++;
    groups.set(label.key, row);
  }

  return {
    rangeDays,
    since,
    tracked: emails.length,
    delivered: emails.filter((e) => e.status === "sent").length,
    failed: emails.filter((e) => e.status === "failed").length,
    summary,
    campaigns: [...groups.values()].sort((a, b) => b.sent - a.sent || a.label.localeCompare(b.label)),
    topLinks: summary.links.slice(0, 10),
  };
}

export interface TrackingEventFilters {
  range: TrackingRange;
  type: "all" | "open" | "click";
  q: string;
  page: number;
}

export function parseTrackingEventFilters(params: Record<string, string | string[] | undefined>): TrackingEventFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const type = first(params.type);
  const page = Math.floor(Number(first(params.page)));
  return {
    range: parseTrackingRange(first(params.range)),
    type: type === "open" || type === "click" ? type : "all",
    q: first(params.q).trim().slice(0, 120),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

export interface TrackingEventRow {
  id: string;
  type: EmailEvent["type"];
  url?: string;
  createdAt: string;
  emailId: string;
  to: string;
  toName?: string;
  subject: string;
  campaign: CampaignLabel;
}

export const TRACKING_EVENTS_PAGE_SIZE = 25;

/** Events in the range, newest first, filtered by type and a search over recipient, subject and link. */
export async function listTrackingEvents(filters: TrackingEventFilters, opts: { all?: boolean; now?: number } = {}) {
  const db = await getDb();
  const since = new Date((opts.now ?? Date.now()) - filters.range * 86_400_000).toISOString();
  const emails = new Map(db.emails.map((e) => [e.id, e] as const));
  const q = filters.q.toLowerCase();
  const rows: TrackingEventRow[] = [];
  for (const event of db.emailEvents) {
    if (event.createdAt < since) continue;
    if (filters.type !== "all" && event.type !== filters.type) continue;
    const email = emails.get(event.emailId);
    if (!email) continue;
    if (q && !email.to.includes(q) && !(email.toName ?? "").toLowerCase().includes(q) && !email.subject.toLowerCase().includes(q) && !(event.url ?? "").toLowerCase().includes(q)) {
      continue;
    }
    rows.push({
      id: event.id,
      type: event.type,
      url: event.url,
      createdAt: event.createdAt,
      emailId: email.id,
      to: email.to,
      toName: email.toName,
      subject: email.subject,
      campaign: campaignLabel(db, email.trackingId),
    });
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const total = rows.length;
  if (opts.all) return { rows, total, page: 1, pageCount: 1 };
  const pageCount = Math.max(1, Math.ceil(total / TRACKING_EVENTS_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  return { rows: rows.slice((page - 1) * TRACKING_EVENTS_PAGE_SIZE, page * TRACKING_EVENTS_PAGE_SIZE), total, page, pageCount };
}

export const TRACKING_CSV_HEADER = ["Time (UTC)", "Event", "Recipient", "Name", "Subject", "Campaign", "Link"];

export function trackingEventsCsvRows(rows: readonly TrackingEventRow[]): string[][] {
  return [
    TRACKING_CSV_HEADER,
    ...rows.map((r) => [r.createdAt, r.type, r.to, r.toName ?? "", r.subject, r.campaign.label, r.url ?? ""]),
  ];
}

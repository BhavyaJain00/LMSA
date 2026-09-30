/**
 * Marketing email content shared by broadcasts and sequence steps: the
 * placeholders an author can use, content validation, and the attribution of
 * unsubscribes to the campaign that caused them.
 *
 * Pure module (no server imports): the composer, the senders and the tests
 * use the same rules.
 */
import type { EmailMessage, Lead, User } from "@/lib/types";
import { acceptsMarketing, type SegmentRecipient } from "./segments";
import { parseTrackingId } from "./tracking-core";

export const CONTENT_LIMITS = { subject: 200, preheader: 150, body: 50_000 } as const;

export type CampaignKind = "broadcast" | "sequence";

export interface PlaceholderInfo {
  key: string;
  description: string;
  /** Only meaningful in sequence emails (they know the course that enrolled the person). */
  sequenceOnly?: boolean;
}

export const CAMPAIGN_PLACEHOLDERS: readonly PlaceholderInfo[] = [
  { key: "first_name", description: "First name, or “there” when it isn't known" },
  { key: "name", description: "Full name" },
  { key: "email", description: "Email address" },
  { key: "site_name", description: "Name of your site" },
  { key: "site_url", description: "Link to your site" },
  { key: "course_title", description: "Course the person enrolled in, bought or asked about", sequenceOnly: true },
  { key: "course_url", description: "Link to that course", sequenceOnly: true },
];

/** Placeholders whose value differs per recipient (filled after the markdown is rendered). */
export const PERSONAL_KEYS = ["first_name", "name", "email"] as const;
/** Placeholders holding trusted absolute URLs. */
export const URL_KEYS = ["site_url", "course_url"] as const;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function placeholdersFor(kind: CampaignKind): PlaceholderInfo[] {
  return CAMPAIGN_PLACEHOLDERS.filter((p) => kind === "sequence" || !p.sequenceOnly);
}

/** `{{ keys }}` used in `text` that the campaign kind doesn't know (usually a typo). */
export function unknownPlaceholders(text: string, kind: CampaignKind): string[] {
  const known = new Set(placeholdersFor(kind).map((p) => p.key));
  const unknown = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    if (!known.has(match[1]!)) unknown.add(match[1]!);
  }
  return [...unknown];
}

/** Per-recipient placeholder values. */
export function personalValues(recipient: Pick<SegmentRecipient, "name" | "firstName" | "email">): Record<string, string> {
  return {
    first_name: recipient.firstName || "there",
    name: recipient.name || recipient.firstName || "there",
    email: recipient.email,
  };
}

export interface CampaignContent {
  subject: string;
  /** Inbox preview text. */
  preheader?: string;
  /** Markdown. */
  body: string;
}

function cleanLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
}

export interface ContentCheck {
  value: CampaignContent;
  /** Field name → message; empty when the content can be sent. */
  errors: Record<string, string>;
}

/**
 * Normalize and check a subject, preheader and markdown body. Field names in
 * `errors` are prefixed with `prefix` (sequence steps use "steps.<n>.").
 */
export function checkContent(raw: { subject?: unknown; preheader?: unknown; body?: unknown }, kind: CampaignKind, prefix = ""): ContentCheck {
  const subject = cleanLine(raw.subject);
  const preheader = cleanLine(raw.preheader);
  const body = typeof raw.body === "string" ? raw.body.replace(/\r\n?/g, "\n").trim() : "";
  const errors: Record<string, string> = {};
  const unknownList = (keys: string[]) => keys.map((k) => `{{ ${k} }}`).join(", ");

  if (!subject) errors[`${prefix}subject`] = "Write a subject line.";
  else if (subject.length > CONTENT_LIMITS.subject) errors[`${prefix}subject`] = `Keep the subject under ${CONTENT_LIMITS.subject} characters.`;
  else {
    const unknown = unknownPlaceholders(subject, kind);
    if (unknown.length) errors[`${prefix}subject`] = `Unknown placeholder ${unknownList(unknown)}.`;
  }

  if (preheader.length > CONTENT_LIMITS.preheader) errors[`${prefix}preheader`] = `Keep the preview text under ${CONTENT_LIMITS.preheader} characters.`;
  else if (preheader) {
    const unknown = unknownPlaceholders(preheader, kind);
    if (unknown.length) errors[`${prefix}preheader`] = `Unknown placeholder ${unknownList(unknown)}.`;
  }

  if (!body) errors[`${prefix}body`] = "Write the message.";
  else if (body.length > CONTENT_LIMITS.body) errors[`${prefix}body`] = `The message is too long (at most ${CONTENT_LIMITS.body.toLocaleString("en-US")} characters).`;
  else {
    const unknown = unknownPlaceholders(body, kind);
    if (unknown.length) errors[`${prefix}body`] = `Unknown placeholder ${unknownList(unknown)}. Check the spelling or remove it.`;
  }

  const value: CampaignContent = { subject, body };
  if (preheader) value.preheader = preheader;
  return { value, errors };
}

/* ------------------------------------------------------------------ */
/* Recipient references                                                */
/* ------------------------------------------------------------------ */

/** Compact reference stored in a broadcast's send queue: "m:<userId>" or "l:<leadId>". */
export function recipientRef(recipient: Pick<SegmentRecipient, "kind" | "id">): string {
  return `${recipient.kind === "lead" ? "l" : "m"}:${recipient.id}`;
}

export function parseRecipientRef(ref: string): { kind: "member" | "lead"; id: string } | null {
  const match = /^([ml]):([A-Za-z0-9_-]{1,64})$/.exec(ref);
  return match ? { kind: match[1] === "l" ? "lead" : "member", id: match[2]! } : null;
}

/* ------------------------------------------------------------------ */
/* Test recipients                                                     */
/* ------------------------------------------------------------------ */

export const MAX_TEST_RECIPIENTS = 5;

/** Addresses typed into a "send test" field: comma, semicolon, space or line separated. */
export function parseAddressList(raw: string): string[] {
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const address = part.trim().toLowerCase();
    if (address) out.add(address);
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* Unsubscribes                                                        */
/* ------------------------------------------------------------------ */

export interface UnsubscribeSource {
  emails: readonly Pick<EmailMessage, "to" | "userId" | "trackingId" | "createdAt">[];
  users: readonly Pick<User, "id" | "emailPreferences">[];
  leads: readonly Pick<Lead, "email" | "unsubscribedAt">[];
}

/** "broadcast:<id>" or "sequence:<id>" (every step of a sequence counts towards the sequence). */
export function campaignKey(trackingId: string | null | undefined): string | null {
  const ref = parseTrackingId(trackingId);
  if (!ref) return null;
  return ref.kind === "broadcast" ? `broadcast:${ref.broadcastId}` : `sequence:${ref.sequenceId}`;
}

/**
 * Unsubscribes per campaign. Everyone who receives a marketing email was
 * subscribed when it was queued, so a recipient who is unsubscribed now left
 * after it; the unsubscribe is credited to the LAST marketing email that
 * address received (one campaign per person, never double counted).
 */
export function countUnsubscribes(source: UnsubscribeSource): Map<string, number> {
  const latest = new Map<string, Pick<EmailMessage, "to" | "userId" | "trackingId" | "createdAt">>();
  for (const email of source.emails) {
    if (!email.trackingId) continue;
    const previous = latest.get(email.to);
    if (!previous || email.createdAt > previous.createdAt) latest.set(email.to, email);
  }
  const users = new Map(source.users.map((u) => [u.id, u] as const));
  const leads = new Map(source.leads.map((l) => [l.email.trim().toLowerCase(), l] as const));
  const counts = new Map<string, number>();
  for (const email of latest.values()) {
    const key = campaignKey(email.trackingId);
    if (!key) continue;
    let unsubscribed = false;
    if (email.userId) {
      const user = users.get(email.userId);
      unsubscribed = !!user && !acceptsMarketing(user);
    } else {
      const lead = leads.get(email.to);
      unsubscribed = !!lead?.unsubscribedAt && lead.unsubscribedAt >= email.createdAt;
    }
    if (unsubscribed) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

import "server-only";
import type { EmailCategory, EmailMessage, EmailStatus } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { describeEmailHeaders, getOutboxCounts, isSensitiveCategory, MAX_ATTEMPTS, type OutboxCounts, redactForView } from "./outbox";
import { EMAIL_CATEGORIES, isEmailCategory } from "./preferences";

/**
 * Read models for the admin outbox (/admin/emails). Bodies are redacted
 * (every `token=` value is hidden) before they leave the server, so staff
 * never see live password-reset or verification links.
 */

export const OUTBOX_PAGE_SIZE = 25;
export const EMAIL_STATUSES: EmailStatus[] = ["queued", "sending", "sent", "failed"];

export function isEmailStatus(value: unknown): value is EmailStatus {
  return typeof value === "string" && (EMAIL_STATUSES as string[]).includes(value);
}

export interface OutboxFilters {
  status: EmailStatus | "all";
  category: EmailCategory | "all";
  q: string;
  page: number;
}

export function parseOutboxFilters(sp: Record<string, string | string[] | undefined>): OutboxFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(sp.status);
  const category = one(sp.category);
  const page = Number.parseInt(one(sp.page), 10);
  return {
    status: isEmailStatus(status) ? status : "all",
    category: isEmailCategory(category) ? category : "all",
    q: one(sp.q).trim().slice(0, 120),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export interface OutboxRow {
  id: string;
  to: string;
  toName?: string;
  ccCount: number;
  subject: string;
  category: EmailCategory;
  status: EmailStatus;
  attempts: number;
  createdAt: string;
  sentAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
}

export interface OutboxList {
  rows: OutboxRow[];
  /** Rows matching the filters. */
  total: number;
  page: number;
  pageCount: number;
  counts: OutboxCounts;
  /** Count per category (ignoring the category filter, honouring the others). */
  categoryCounts: Partial<Record<EmailCategory, number>>;
}

function toRow(e: EmailMessage): OutboxRow {
  return {
    id: e.id,
    to: e.to,
    toName: e.toName,
    ccCount: e.cc?.length ?? 0,
    subject: e.subject,
    category: e.category,
    status: e.status,
    attempts: e.attempts,
    createdAt: e.createdAt,
    sentAt: e.sentAt,
    nextAttemptAt: e.nextAttemptAt,
    lastError: e.lastError ? redactForView(e.lastError) : undefined,
  };
}

function matchesQuery(e: EmailMessage, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    e.to.includes(needle) ||
    (e.toName ?? "").toLowerCase().includes(needle) ||
    e.subject.toLowerCase().includes(needle) ||
    (e.cc ?? []).some((c) => c.includes(needle)) ||
    e.id === q
  );
}

export async function listOutbox(filters: OutboxFilters): Promise<OutboxList> {
  const db = await getDb();
  const counts = await getOutboxCounts();
  const base = db.emails.filter((e) => (filters.status === "all" || e.status === filters.status) && matchesQuery(e, filters.q));
  const categoryCounts: Partial<Record<EmailCategory, number>> = {};
  for (const e of base) categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
  const filtered = base
    .filter((e) => filters.category === "all" || e.category === filters.category)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const pageCount = Math.max(1, Math.ceil(filtered.length / OUTBOX_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const rows = filtered.slice((page - 1) * OUTBOX_PAGE_SIZE, page * OUTBOX_PAGE_SIZE).map(toRow);
  return { rows, total: filtered.length, page, pageCount, counts, categoryCounts };
}

export interface OutboxEmailView extends OutboxRow {
  cc: string[];
  userId?: string;
  user?: { id: string; name: string; username: string };
  messageId?: string;
  /** Redacted HTML with `<base target="_blank">` for the sandboxed preview. */
  previewHtml: string;
  /** Redacted HTML source. */
  html: string;
  /** Redacted plain-text part. */
  text: string;
  headers: [string, string][];
  maxAttempts: number;
  sensitive: boolean;
  canRetry: boolean;
  canResend: boolean;
  canDelete: boolean;
}

function withBaseTarget(html: string): string {
  const base = '<base target="_blank">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  return `${base}${html}`;
}

export async function getOutboxEmail(id: string): Promise<OutboxEmailView | null> {
  const db = await getDb();
  const e = db.emails.find((x) => x.id === id);
  if (!e) return null;
  const user = e.userId ? db.users.find((u) => u.id === e.userId) : null;
  const sensitive = isSensitiveCategory(e.category);
  const html = redactForView(e.html);
  const headers = (await describeEmailHeaders(e)).map(([k, v]): [string, string] => [k, redactForView(v)]);
  return {
    ...toRow(e),
    cc: e.cc ?? [],
    userId: e.userId,
    user: user ? { id: user.id, name: user.name, username: user.username } : undefined,
    messageId: e.messageId,
    previewHtml: withBaseTarget(html),
    html,
    text: redactForView(e.text),
    headers,
    maxAttempts: MAX_ATTEMPTS,
    sensitive,
    canRetry: e.status === "queued" || (e.status === "failed" && !sensitive),
    canResend: (e.status === "sent" || e.status === "failed") && !sensitive,
    canDelete: e.status !== "sending",
  };
}

export { EMAIL_CATEGORIES };

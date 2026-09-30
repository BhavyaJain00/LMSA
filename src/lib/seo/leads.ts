import type { Lead } from "@/lib/types";

/**
 * Lead capture rules (pure): source labels, statuses, admin filters, stats and
 * CSV rows, plus the bot checks used by the public form.
 */

export type LeadStatus = "pending" | "confirmed" | "unsubscribed";

/** Sources are short machine labels ("blog", "course:crs_js", "footer", "free"). */
export function normalizeLeadSource(raw: string | undefined | null): string {
  const clean = (raw ?? "").trim().toLowerCase().slice(0, 80);
  return /^[a-z0-9][a-z0-9:_./-]*$/.test(clean) ? clean : "website";
}

/** Readable label for a source ("course:crs_js" → "Course page", "blog:my-post" → "Blog post"). */
export function leadSourceLabel(source: string): string {
  const [kind] = source.split(":", 1);
  switch (kind) {
    case "blog":
      return "Blog";
    case "course":
      return "Course page";
    case "footer":
      return "Footer";
    case "free":
      return "Free resources page";
    case "sitemap":
      return "Sitemap page";
    default:
      return kind ? kind[0]!.toUpperCase() + kind.slice(1) : "Website";
  }
}

export function leadStatus(lead: Pick<Lead, "confirmedAt" | "unsubscribedAt">): LeadStatus {
  if (lead.unsubscribedAt) return "unsubscribed";
  return lead.confirmedAt ? "confirmed" : "pending";
}

export interface LeadQuery {
  status?: LeadStatus | "all";
  source?: string;
  courseId?: string;
  search?: string;
  /** YYYY-MM-DD, inclusive */
  from?: string;
  to?: string;
}

export function filterLeads<T extends Lead>(leads: T[], q: LeadQuery): T[] {
  const search = q.search?.trim().toLowerCase();
  const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? `${q.from}T00:00:00.000Z` : undefined;
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? `${q.to}T23:59:59.999Z` : undefined;
  return leads
    .filter((l) => !q.status || q.status === "all" || leadStatus(l) === q.status)
    .filter((l) => !q.source || l.source === q.source || l.source.startsWith(`${q.source}:`))
    .filter((l) => !q.courseId || l.courseId === q.courseId)
    .filter((l) => !search || l.email.includes(search) || (l.name ?? "").toLowerCase().includes(search))
    .filter((l) => !from || l.createdAt >= from)
    .filter((l) => !to || l.createdAt <= to)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface LeadStats {
  total: number;
  confirmed: number;
  pending: number;
  unsubscribed: number;
  /** Confirmed ÷ (confirmed + pending), 0–100. */
  confirmationRate: number;
  last7Days: number;
  last30Days: number;
  bySource: { source: string; label: string; count: number }[];
  /** Sign-ups per day for the last 30 days (oldest first). */
  daily: { date: string; count: number }[];
}

export function leadStats(leads: Lead[], now: number = Date.now()): LeadStats {
  const counts = { confirmed: 0, pending: 0, unsubscribed: 0 };
  const sources = new Map<string, number>();
  const days = new Map<string, number>();
  const today = new Date(now);
  for (let i = 29; i >= 0; i--) days.set(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10), 0);
  let last7 = 0;
  let last30 = 0;
  for (const lead of leads) {
    counts[leadStatus(lead)]++;
    const kind = lead.source.split(":", 1)[0] || "website";
    sources.set(kind, (sources.get(kind) ?? 0) + 1);
    const age = now - Date.parse(lead.createdAt);
    if (age <= 7 * 86_400_000) last7++;
    if (age <= 30 * 86_400_000) last30++;
    const day = lead.createdAt.slice(0, 10);
    if (days.has(day)) days.set(day, days.get(day)! + 1);
  }
  const decided = counts.confirmed + counts.pending;
  return {
    total: leads.length,
    ...counts,
    confirmationRate: decided ? Math.round((counts.confirmed / decided) * 100) : 0,
    last7Days: last7,
    last30Days: last30,
    bySource: [...sources].map(([source, count]) => ({ source, label: leadSourceLabel(source), count })).sort((a, b) => b.count - a.count),
    daily: [...days].map(([date, count]) => ({ date, count })),
  };
}

export const LEAD_CSV_HEADER = ["Email", "Name", "Status", "Source", "Course", "Consent", "Signed up", "Confirmed", "Unsubscribed"];

/** CSV rows (header first) for the admin export. */
export function leadCsvRows(leads: Lead[], courseTitles: ReadonlyMap<string, string>): string[][] {
  return [
    LEAD_CSV_HEADER,
    ...leads.map((l) => [
      l.email,
      l.name ?? "",
      leadStatus(l),
      l.source,
      l.courseId ? (courseTitles.get(l.courseId) ?? l.courseId) : "",
      l.consent ? "yes" : "no",
      l.createdAt,
      l.confirmedAt ?? "",
      l.unsubscribedAt ?? "",
    ]),
  ];
}

/** Minimum time a human needs to fill the form (bots submit instantly). */
export const MIN_FILL_MS = 1500;
/** Forms older than this are stale (the timestamp is part of the anti-bot check). */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Bot heuristics for the public lead form: the hidden honeypot field must be
 * empty and the form must have been on screen for a human-plausible time.
 */
export function looksAutomated(honeypot: string, renderedAt: number, now: number = Date.now()): boolean {
  if (honeypot.trim()) return true;
  if (!Number.isFinite(renderedAt) || renderedAt <= 0) return true;
  const age = now - renderedAt;
  return age < MIN_FILL_MS || age > MAX_FORM_AGE_MS;
}

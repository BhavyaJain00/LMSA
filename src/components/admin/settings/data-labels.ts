/**
 * Names shown for database collections and backup kinds on
 * Admin → Settings → Backup & reset (server page and client components).
 */

const COLLECTION_LABELS: Record<string, string> = {
  users: "Members",
  sessions: "Active sessions",
  progress: "Lesson progress",
  videoWatches: "Video watch records",
  notes: "Lesson notes",
  liveClasses: "Live classes",
  jobs: "Job openings",
  activities: "Activity log entries",
  emails: "Emails",
  authTokens: "Account tokens",
  loginEvents: "Sign-in history",
  loginThrottles: "Sign-in throttles",
  points: "Points awarded",
  uploadSessions: "Uploads in progress",
  transcodeJobs: "Video conversions",
  slugRedirects: "URL redirects",
  consents: "Cookie consents",
  auditEvents: "Audit log entries",
  errorEvents: "Error log entries",
  dataRequests: "Privacy requests",
  aiConversations: "AI tutor conversations",
  aiMessages: "AI tutor messages",
  aiClarifications: "AI tutor clarifications",
  plans: "Membership plans",
  subscriptions: "Memberships",
  orgSeats: "Team seats",
  apiKeys: "API keys",
};

/** "quizSubmissions" → "Quiz submissions" (collections without a dedicated label). */
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function collectionLabel(name: string): string {
  return COLLECTION_LABELS[name] ?? humanize(name);
}

export type BackupKindName = "auto" | "manual" | "safety" | "upload";

export const BACKUP_KIND_LABELS: Record<BackupKindName, string> = {
  auto: "Automatic",
  manual: "Manual",
  safety: "Safety",
  upload: "Uploaded",
};

export const BACKUP_KIND_HINTS: Record<BackupKindName, string> = {
  auto: "Made once a day by the server.",
  manual: "Made by an administrator. Kept until deleted.",
  safety: "The data as it was just before a restore.",
  upload: "A file uploaded by an administrator.",
};

export interface CountChange {
  name: string;
  label: string;
  current: number;
  backup: number;
  /** backup − current */
  difference: number;
}

/**
 * Collections whose number of documents differs between the live database
 * and a backup, largest change first (ties by label).
 */
export function countChanges(current: Record<string, number>, backup: Record<string, number>): CountChange[] {
  const names = new Set([...Object.keys(current), ...Object.keys(backup)]);
  const changes: CountChange[] = [];
  for (const name of names) {
    const now = current[name] ?? 0;
    const then = backup[name] ?? 0;
    if (now === then) continue;
    changes.push({ name, label: collectionLabel(name), current: now, backup: then, difference: then - now });
  }
  return changes.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.label.localeCompare(b.label));
}

/** "+12", "−3", "0": a signed difference with a real minus sign. */
export function signedNumber(n: number): string {
  if (n === 0) return "0";
  const text = new Intl.NumberFormat("en-US").format(Math.abs(n));
  return n > 0 ? `+${text}` : `−${text}`;
}

/** File extensions accepted by "Restore from a file". */
export const BACKUP_FILE_EXTENSIONS = [".sqlite", ".sqlite3", ".db", ".json"] as const;

export function isBackupFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return BACKUP_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/* ------------------------------------------------------------------ */
/* The backups list                                                    */
/* ------------------------------------------------------------------ */

/**
 * One backup as the list shows it. Dates are formatted on the server
 * (`createdLabel`, `ageLabel`) so the browser's time zone cannot make the
 * first render differ from the server's.
 */
export interface BackupRow {
  name: string;
  kind: BackupKindName;
  format: "sqlite" | "json";
  createdAt: string;
  createdLabel: string;
  ageLabel: string;
  sizeBytes: number;
  records: number | null;
  counts: Record<string, number> | null;
  schemaVersion: number | null;
  reason?: string;
  createdBy?: string;
  originalName?: string;
}

export type BackupKindFilter = BackupKindName | "all";

export const BACKUP_KIND_FILTERS: readonly BackupKindFilter[] = ["all", "auto", "manual", "safety", "upload"];

export const BACKUPS_PER_PAGE = 10;

/** Backups of `kind` whose name, note, author or original file name contains `query` (case-insensitive). */
export function filterBackups<T extends Pick<BackupRow, "name" | "kind" | "reason" | "createdBy" | "originalName">>(rows: readonly T[], kind: BackupKindFilter, query: string): T[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (kind !== "all" && row.kind !== kind) return false;
    if (!needle) return true;
    return [row.name, row.reason, row.createdBy, row.originalName].some((text) => text?.toLowerCase().includes(needle));
  });
}

/** How many backups of each kind there are (for the filter tabs). */
export function countByKind(rows: readonly Pick<BackupRow, "kind">[]): Record<BackupKindFilter, number> {
  const counts: Record<BackupKindFilter, number> = { all: rows.length, auto: 0, manual: 0, safety: 0, upload: 0 };
  for (const row of rows) counts[row.kind]++;
  return counts;
}

/** One page of `rows`; `page` is clamped to the pages that exist (1-based). */
export function pageOf<T>(rows: readonly T[], page: number, perPage: number = BACKUPS_PER_PAGE): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  const start = (current - 1) * perPage;
  const items = rows.slice(start, start + perPage);
  return { items, page: current, pages, from: items.length ? start + 1 : 0, to: start + items.length };
}

/** Collections with documents, largest first (ties by label), for the "what is in this backup" list. */
export function sortedCounts(counts: Record<string, number>): { name: string; label: string; count: number }[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, label: collectionLabel(name), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Why a file chosen for "Restore from a file" cannot be uploaded, or null when it can. */
export function uploadProblem(file: { name: string; size: number }, maxBytes: number): string | null {
  if (!isBackupFileName(file.name)) return `Choose a backup file (${BACKUP_FILE_EXTENSIONS.join(", ")}).`;
  if (file.size === 0) return "That file is empty.";
  if (file.size > maxBytes) return `That file is larger than the ${Math.round(maxBytes / (1024 * 1024)).toLocaleString("en-US")} MB limit for backups.`;
  return null;
}

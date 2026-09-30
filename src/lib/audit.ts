import "server-only";
import { headers } from "next/headers";
import type { AuditEvent } from "@/lib/types";
import { insert } from "@/lib/db/store";
import { clientIpFromHeaders, UNKNOWN_IP } from "@/lib/auth/request-info";
import { uid } from "@/lib/utils";
import { toCsv } from "@/components/admin/settings/member-import-csv";

/**
 * Admin audit log.
 *
 * Call `audit()` after a security-relevant change succeeds (settings saved,
 * roles changed, course published or deleted, refund issued, data exported,
 * …). It never throws: a failure to record an audit event must not undo or
 * fail the action being audited, so problems are only logged to the console.
 *
 * Keep `meta` small and free of secrets and personal data beyond ids — it is
 * shown verbatim to administrators and exported as CSV.
 */

const MAX_ACTION_LENGTH = 100;
const MAX_ID_LENGTH = 200;
const MAX_META_KEYS = 30;
const MAX_META_KEY_LENGTH = 60;
const MAX_META_STRING_LENGTH = 500;

type AuditMeta = NonNullable<AuditEvent["meta"]>;

/** Strip control characters and cap the length of free text stored in the log. */
function clean(value: string, max: number): string {
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Keep only primitive values, a bounded number of keys and bounded strings. */
export function sanitizeAuditMeta(meta: AuditMeta | undefined): AuditMeta | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const out: AuditMeta = {};
  let kept = 0;
  for (const [rawKey, value] of Object.entries(meta)) {
    if (kept >= MAX_META_KEYS) break;
    const key = clean(rawKey, MAX_META_KEY_LENGTH);
    if (!key || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number") out[key] = Number.isFinite(value) ? value : null;
    else if (typeof value === "string") out[key] = clean(value, MAX_META_STRING_LENGTH);
    else continue;
    kept++;
  }
  return kept ? out : undefined;
}

/** Build the event record (pure; exported for tests). */
export function buildAuditEvent(
  actor: { id: string } | null,
  action: string,
  target: { type: string; id: string } | undefined,
  meta: AuditMeta | undefined,
  ip: string | undefined,
  now: Date = new Date(),
): AuditEvent {
  const event: AuditEvent = {
    id: uid("aud"),
    action: clean(action, MAX_ACTION_LENGTH) || "unknown",
    createdAt: now.toISOString(),
  };
  if (actor?.id) event.actorId = clean(actor.id, MAX_ID_LENGTH);
  if (target?.type && target.id) {
    event.targetType = clean(target.type, MAX_ID_LENGTH);
    event.targetId = clean(target.id, MAX_ID_LENGTH);
  }
  const safeMeta = sanitizeAuditMeta(meta);
  if (safeMeta) event.meta = safeMeta;
  if (ip && ip !== UNKNOWN_IP) event.ip = ip;
  return event;
}

/** Client IP of the current request, when there is one and it can be trusted. */
async function currentIp(): Promise<string | undefined> {
  try {
    return clientIpFromHeaders(await headers());
  } catch {
    // Called outside a request (background job, script): no IP to record.
    return undefined;
  }
}

/**
 * Record an audit event. Never throws.
 *
 * @example
 *   await audit(user, "course.publish", { type: "course", id: course.id }, { title: course.title });
 */
export async function audit(
  actor: { id: string } | null,
  action: string,
  target?: { type: string; id: string },
  meta?: AuditEvent["meta"],
): Promise<void> {
  try {
    const event = buildAuditEvent(actor, action, target, meta, await currentIp());
    await insert("auditEvents", event);
  } catch (err) {
    console.error("[audit] failed to record event", action, err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ */
/* Querying (admin audit log page and CSV export)                      */
/* ------------------------------------------------------------------ */

/** Human labels for the actions recorded across the app (unknown actions are humanized). */
const ACTION_LABELS: Record<string, string> = {
  "settings.update": "Settings changed",
  "user.create": "Member created",
  "user.import": "Members imported",
  "user.update": "Member profile edited",
  "user.roles": "Roles changed",
  "user.enable": "Account enabled",
  "user.disable": "Account disabled",
  "user.password": "Password set by admin",
  "user.delete": "Member deleted",
  "course.publish": "Course published",
  "course.unpublish": "Course unpublished",
  "course.delete": "Course deleted",
  "payment.refund": "Payment refunded",
  "payment.mark_paid": "Payment marked as paid",
  "payment.delete": "Payment deleted",
  "certificate.issue": "Certificate issued",
  "certificate.bulk_issue": "Certificates issued in bulk",
  "certificate.revoke": "Certificate revoked",
  "backup.create": "Backup created",
  "backup.download": "Backup downloaded",
  "backup.restore": "Backup restored",
  "data.reset": "Demo data reset",
  "legal.save": "Legal page saved",
  "legal.publish": "Legal page published",
  "legal.unpublish": "Legal page unpublished",
  "legal.delete": "Legal page deleted",
  "privacy.export": "Personal data downloaded",
  "account.delete": "Account deleted by its owner",
  "error.resolve": "Error marked resolved",
  "error.reopen": "Error reopened",
  "error.delete": "Error deleted",
  "retention.purge": "Old records purged",
  "audit.export": "Audit log exported",
};

export function describeAuditAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const text = action.replace(/[._]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown action";
}

/** "course.publish" → "course" (used to group the action filter). */
export function auditActionGroup(action: string): string {
  const dot = action.indexOf(".");
  return dot === -1 ? action : action.slice(0, dot);
}

export interface AuditFilter {
  /** Free text: action, target, IP, meta values, actor name/email. */
  q: string;
  /** Actor user id, or "system" for events without an actor. */
  actor: string;
  /** Exact action ("course.publish") or a whole group ("course.*"). */
  action: string;
  targetType: string;
  /** Inclusive day bounds, YYYY-MM-DD (UTC). */
  from: string;
  to: string;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type SearchInput = URLSearchParams | Record<string, string | string[] | undefined>;

function param(input: SearchInput, key: string): string {
  const raw = input instanceof URLSearchParams ? input.get(key) : input[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export function parseAuditFilter(input: SearchInput): AuditFilter {
  const from = param(input, "from");
  const to = param(input, "to");
  return {
    q: param(input, "q"),
    actor: param(input, "actor"),
    action: param(input, "action"),
    targetType: param(input, "target"),
    from: DAY_PATTERN.test(from) ? from : "",
    to: DAY_PATTERN.test(to) ? to : "",
  };
}

export function auditFilterToQuery(filter: AuditFilter): Record<string, string | undefined> {
  return {
    q: filter.q || undefined,
    actor: filter.actor || undefined,
    action: filter.action || undefined,
    target: filter.targetType || undefined,
    from: filter.from || undefined,
    to: filter.to || undefined,
  };
}

type ActorInfo = { name: string; email: string };

/** Matching events, newest first. `actors` resolves actor ids for the text search. */
export function filterAuditEvents(events: readonly AuditEvent[], filter: AuditFilter, actors: ReadonlyMap<string, ActorInfo>): AuditEvent[] {
  const needle = filter.q.toLowerCase();
  const fromMs = filter.from ? Date.parse(`${filter.from}T00:00:00.000Z`) : null;
  const toMs = filter.to ? Date.parse(`${filter.to}T23:59:59.999Z`) : null;
  const groupPrefix = filter.action.endsWith(".*") ? `${filter.action.slice(0, -2)}.` : null;
  return events
    .filter((e) => {
      if (filter.actor === "system" ? !!e.actorId : filter.actor && e.actorId !== filter.actor) return false;
      if (filter.action && (groupPrefix ? !e.action.startsWith(groupPrefix) && e.action !== groupPrefix.slice(0, -1) : e.action !== filter.action)) return false;
      if (filter.targetType && e.targetType !== filter.targetType) return false;
      const t = Date.parse(e.createdAt);
      if (fromMs !== null && !(t >= fromMs)) return false;
      if (toMs !== null && !(t <= toMs)) return false;
      if (needle) {
        const actor = e.actorId ? actors.get(e.actorId) : undefined;
        const meta = e.meta ? Object.entries(e.meta).map(([k, v]) => `${k} ${String(v)}`).join(" ") : "";
        const hay = `${e.action} ${describeAuditAction(e.action)} ${e.targetType ?? ""} ${e.targetId ?? ""} ${e.ip ?? ""} ${meta} ${actor?.name ?? ""} ${actor?.email ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** CSV (with header row) of audit events for spreadsheets. */
export function auditEventsToCsv(events: readonly AuditEvent[], actors: ReadonlyMap<string, ActorInfo>): string {
  const header = ["Time (UTC)", "Action", "Description", "Actor", "Actor email", "Target type", "Target id", "IP address", "Details"];
  const rows = events.map((e) => {
    const actor = e.actorId ? actors.get(e.actorId) : undefined;
    return [
      e.createdAt,
      e.action,
      describeAuditAction(e.action),
      e.actorId ? (actor?.name ?? e.actorId) : "System",
      actor?.email ?? "",
      e.targetType ?? "",
      e.targetId ?? "",
      e.ip ?? "",
      e.meta ? JSON.stringify(e.meta) : "",
    ];
  });
  // Formula-looking cells are neutralized by `toCsv` (meta values are admin-visible free text).
  return toCsv([header, ...rows]);
}

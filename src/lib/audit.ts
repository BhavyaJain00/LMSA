import "server-only";
import { headers } from "next/headers";
import type { AuditEvent } from "@/lib/types";
import { insert } from "@/lib/db/store";
import { clientIpFromHeaders, UNKNOWN_IP } from "@/lib/auth/request-info";
import { uid } from "@/lib/utils";

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

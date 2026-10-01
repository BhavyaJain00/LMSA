import "server-only";
import { headers } from "next/headers";
import type { AuditEvent } from "@/lib/types";
import { insert } from "@/lib/db/store";
import { clientIpFromHeaders, UNKNOWN_IP } from "@/lib/auth/request-info";
import { uid } from "@/lib/utils";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { maybePurgeExpiredRecords } from "@/lib/legal/retention-run";

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
 *
 * Every new entry also gives the retention purge a chance to run (it limits
 * itself to once every few hours), so the log stays within
 * `settings.legal.dataRetentionDays` even if nobody opens the audit page.
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
    // Not awaited: the purge records its own `retention.purge` event through this function.
    void maybePurgeExpiredRecords();
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
  "settings.ai": "AI tutor settings changed",
  "settings.api": "Public API switched on or off",
  "user.create": "Member created",
  "user.import": "Members imported",
  "user.update": "Member profile edited",
  "user.roles": "Roles changed",
  "user.enable": "Account enabled",
  "user.disable": "Account disabled",
  "user.password": "Password set by admin",
  "user.delete": "Member deleted",
  "user.unlock": "Account unlocked",
  "user.two_factor_reset": "Two-step verification reset",
  "user.email_verified": "Email marked as confirmed",
  "user.password_reset_sent": "Password reset link sent",
  "user.sign_out_everywhere": "Signed out on every device",
  "course.publish": "Course published",
  "course.unpublish": "Course unpublished",
  "course.delete": "Course deleted",
  "course.approve": "Course approved",
  "payment.refund": "Payment refunded",
  "payment.mark_paid": "Payment marked as paid",
  "payment.delete": "Payment deleted",
  "payment.record": "Payment recorded manually",
  "payment.update": "Payment details edited",
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
  "legal.create": "Legal page created",
  "legal.restore_template": "Legal page reset to template",
  "privacy.export": "Personal data downloaded",
  "account.delete": "Account deleted by its owner",
  "account.erase": "Account erased by an administrator",
  "error.resolve": "Error marked resolved",
  "error.reopen": "Error reopened",
  "error.delete": "Error deleted",
  "retention.purge": "Old records purged",
  "audit.export": "Audit log exported",
  "api_key.create": "API key created",
  "api_key.revoke": "API key revoked",
  "api_key.delete": "API key deleted",
  "api.user.create": "Member created through the API",
  "api.user.update": "Member edited through the API",
  "api.course.create": "Course created through the API",
  "api.course.update": "Course edited through the API",
  "api.enrollment.create": "Enrollment created through the API",
  "api.enrollment.delete": "Enrollment removed through the API",
  "api.batch_member.add": "Batch member added through the API",
  "plan.create": "Membership plan created",
  "plan.update": "Membership plan edited",
  "plan.activate": "Membership plan activated",
  "plan.retire": "Membership plan retired",
  "plan.delete": "Membership plan deleted",
  "membership.grant": "Membership granted",
  "membership.extend": "Membership extended",
  "membership.cancel": "Membership cancelled",
  "membership.resume": "Membership resumed",
  "affiliate.apply": "Affiliate application received",
  "affiliate.status": "Affiliate status changed",
  "affiliate.update": "Affiliate edited",
  "affiliate.payout": "Affiliate payout recorded",
  "affiliate.payout_email": "Affiliate payout email changed",
  "affiliate.commissions_approve": "Commissions approved",
  "affiliate.commissions_void": "Commissions voided",
  "affiliate.export": "Affiliate report exported",
  "ai.message.report": "AI answer reported",
  "ai.review.approve": "AI answer approved",
  "ai.review.correct": "AI answer corrected",
  "ai.review.reopen": "AI answer review reopened",
  "ai.export": "AI review queue exported",
  "seo.indexnow_key": "IndexNow key changed",
  "seo.indexnow_submit": "URLs submitted to IndexNow",
  "seo.redirect_add": "Redirect added",
  "seo.redirect_delete": "Redirect deleted",
  "seo.redirect_export": "Redirects exported",
  "category.landing_update": "Category landing page edited",
  "storage.test": "Storage connection tested",
  "storage.migrate": "Files moved to another storage",
  "media.transcode_start": "Video conversion started",
  "media.transcode_retry": "Video conversion retried",
  "media.transcode_cancel": "Video conversion cancelled",
  "transcript.save": "Transcript saved",
  "transcript.delete": "Transcript deleted",
  "transcript.generate": "Transcript generation requested",
  "rubric.create": "Rubric created",
  "rubric.update": "Rubric edited",
  "rubric.duplicate": "Rubric duplicated",
  "rubric.delete": "Rubric deleted",
  "peer_review.override": "Peer review overridden",
  "peer_review.reassign": "Peer review reassigned",
  "peer_review.add": "Peer review added",
  "peer_review.remove": "Peer review removed",
  "peer_review.allocate": "Peer reviews allocated",
  "peer_review.remind": "Peer reviewers reminded",
  "peer_review.export": "Peer reviews exported",
  "broadcast.tracking_export": "Email tracking exported",
  "broadcast.audience_export": "Broadcast audience exported",
  "settings.taxes": "Tax settings changed",
  "settings.checkout_recovery": "Abandoned checkout settings changed",
  "backup.upload": "Backup uploaded",
  "backup.delete": "Backup deleted",
  "analytics.export": "Analytics report exported",
  "blog.create": "Article created",
  "blog.update": "Article edited",
  "blog.delete": "Article deleted",
  "blog.duplicate": "Article duplicated",
  "blog.export": "Articles exported",
  "blog.bulk_publish": "Articles published in bulk",
  "blog.bulk_draft": "Articles moved to drafts in bulk",
  "blog.bulk_noindex": "Articles hidden from search engines in bulk",
  "blog.bulk_index": "Articles shown to search engines in bulk",
  "blog.bulk_delete": "Articles deleted in bulk",
  "leads.delete": "Leads deleted",
  "leads.export": "Leads exported",
  "leads.resend_confirmation": "Lead confirmation email resent",
  "course.duplicate": "Course duplicated",
  "course.schedule": "Course publication scheduled",
  "course.schedule_change": "Course publication rescheduled",
  "course.schedule_cancel": "Scheduled course publication cancelled",
  "course.sales_page.update": "Sales page edited",
  "course.sales_page.remove": "Sales page removed",
  "lesson.publish": "Scheduled lesson published",
  "lesson.publish_now": "Lesson published now",
  "lesson.schedule": "Lesson publication scheduled",
  "lesson.schedule_change": "Lesson publication rescheduled",
  "lesson.version_restore": "Lesson version restored",
  "assignment.review_settings": "Peer review settings changed",
  "marketplace.settings": "Marketplace settings changed",
  "marketplace.terms": "Instructor terms changed",
  "marketplace.apply": "Instructor application sent",
  "marketplace.approve": "Instructor approved",
  "marketplace.reject": "Instructor application rejected",
  "marketplace.payout": "Instructor payout recorded",
  "marketplace.payout_email": "Instructor payout email changed",
  "marketplace.export": "Instructor earnings exported",
  "bundle.create": "Bundle created",
  "bundle.update": "Bundle edited",
  "bundle.duplicate": "Bundle duplicated",
  "upsell.create": "Upsell created",
  "upsell.update": "Upsell edited",
  "gift.order": "Gift order placed",
  "gift.resend": "Gift email resent",
  "item.prices": "Prices in other currencies changed",
  "tax_rule.create": "Tax rule created",
  "tax_rule.update": "Tax rule edited",
  "tax_rule.delete": "Tax rule deleted",
  "installments.offer": "Installment plan offered",
  "installments.withdraw": "Installment plan withdrawn",
  "installments.cancel": "Installment plan cancelled",
  "installments.remind": "Installment reminder sent",
  "installments.waive": "Installment waived",
  "checkout_recovery.run": "Abandoned checkout reminders sent",
  "checkout_recovery.stop": "Abandoned checkout reminders stopped",
  "team.create": "Team created",
  "team.rename": "Team renamed",
  "team.delete": "Team deleted",
  "team.export": "Team members exported",
  "team.invite": "Team members invited",
  "team.invite_resend": "Team invitation resent",
  "team.manager_add": "Team manager added",
  "team.manager_remove": "Team manager removed",
  "team.owner_transfer": "Team ownership transferred",
  "team.courses_update": "Team courses changed",
  "team.seat_reassign": "Team seat reassigned",
  "team.seat_revoke": "Team seat revoked",
  "team.seats_adjust": "Team seats adjusted",
  "team.seats_purchase": "Team seats purchased",
  "team.seats_refund": "Team seats refunded",
  "team.invoice_request": "Team invoice requested",
  "broadcast.create": "Broadcast created",
  "broadcast.schedule": "Broadcast scheduled",
  "broadcast.unschedule": "Broadcast unscheduled",
  "broadcast.send": "Broadcast sending started",
  "broadcast.sent": "Broadcast sent",
  "broadcast.pause": "Broadcast paused",
  "broadcast.resume": "Broadcast resumed",
  "broadcast.cancel": "Broadcast cancelled",
  "broadcast.delete": "Broadcast deleted",
  "broadcast.export": "Broadcast report exported",
  "sequence.create": "Email sequence created",
  "sequence.update": "Email sequence edited",
  "sequence.activate": "Email sequence activated",
  "sequence.pause": "Email sequence paused",
  "sequence.delete": "Email sequence deleted",
  "sequence.export": "Email sequence report exported",
  "sequence.stop_all": "Email sequence stopped for everyone",
  "sequence.stop_enrollment": "Email sequence stopped for a member",
  "message.report": "Message reported",
  "message.report_resolve": "Message report resolved",
  "message.remove": "Message removed",
  "message.report_export": "Message reports exported",
  "webhook.create": "Webhook created",
  "webhook.update": "Webhook edited",
  "webhook.delete": "Webhook deleted",
  "webhook.enable": "Webhook enabled",
  "webhook.disable": "Webhook disabled",
  "webhook.auto_disable": "Webhook disabled after repeated failures",
  "webhook.test": "Test webhook sent",
  "webhook.resend": "Webhook delivery resent",
  "webhook.resend_failed": "Failed webhook deliveries resent",
  "webhook.secret_reveal": "Webhook secret revealed",
  "webhook.secret_rotate": "Webhook secret rotated",
  "webhook.export": "Webhook deliveries exported",
  "api.webhook.create": "Webhook created through the API",
  "api.webhook.update": "Webhook edited through the API",
  "api.webhook.delete": "Webhook deleted through the API",
  "api.webhook.test": "Test webhook sent through the API",
  "api.webhook.resend": "Webhook delivery resent through the API",
  "api.webhook.secret_rotate": "Webhook secret rotated through the API",
};

/** "peer_review.add" → "Peer review add" (labels for actions and targets without a dedicated one). */
function humanize(value: string, fallback: string): string {
  const text = value.replace(/[._]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : fallback;
}

export function describeAuditAction(action: string): string {
  return ACTION_LABELS[action] ?? humanize(action, "Unknown action");
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

export type SearchInput = URLSearchParams | Record<string, string | string[] | undefined>;

/** One trimmed query parameter (first value, at most 200 characters; "" when missing). */
export function searchParam(input: SearchInput, key: string): string {
  const raw = input instanceof URLSearchParams ? input.get(key) : input[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export function parseAuditFilter(input: SearchInput): AuditFilter {
  const from = searchParam(input, "from");
  const to = searchParam(input, "to");
  return {
    q: searchParam(input, "q"),
    actor: searchParam(input, "actor"),
    action: searchParam(input, "action"),
    targetType: searchParam(input, "target"),
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

/** Rows per page on the audit log. */
export const AUDIT_PAGE_SIZE = 50;

/** True when any filter is set (the page then offers "Clear filters"). */
export function isAuditFilterActive(filter: AuditFilter): boolean {
  return !!(filter.q || filter.actor || filter.action || filter.targetType || filter.from || filter.to);
}

const TARGET_LABELS: Record<string, string> = {
  user: "Member",
  course: "Course",
  batch: "Batch",
  lesson: "Lesson",
  payment: "Payment",
  certificate: "Certificate",
  settings: "Settings",
  legal_page: "Legal page",
  affiliate: "Affiliate",
  ai_message: "AI tutor answer",
  transcode_job: "Video conversion",
  error: "Error",
  api_key: "API key",
  plan: "Membership plan",
  subscription: "Membership",
  enrollment: "Enrollment",
  assignment: "Assignment",
  rubric: "Rubric",
  peer_review: "Peer review",
  redirect: "Redirect",
  category: "Category",
  export: "Export",
  blog_post: "Article",
  bundle: "Bundle",
  upsell: "Upsell",
  gift: "Gift",
  tax_rule: "Tax rule",
  checkout_session: "Checkout",
  team: "Team",
  instructor: "Instructor",
  payout: "Payout",
  broadcast: "Broadcast",
  sequence: "Email sequence",
  conversation: "Conversation",
  webhook: "Webhook",
};

/** Names of the action groups ("course.*") in the action filter. */
const GROUP_LABELS: Record<string, string> = {
  user: "Members",
  account: "Account deletion",
  privacy: "Personal data",
  settings: "Settings",
  course: "Courses",
  payment: "Payments",
  certificate: "Certificates",
  legal: "Legal pages",
  backup: "Backups",
  data: "Demo data",
  audit: "Audit log",
  retention: "Retention",
  error: "Error log",
  api: "Public API",
  api_key: "API keys",
  plan: "Membership plans",
  membership: "Memberships",
  affiliate: "Affiliates",
  ai: "AI tutor",
  seo: "SEO",
  category: "Categories",
  storage: "Storage",
  media: "Video conversion",
  transcript: "Transcripts",
  rubric: "Rubrics",
  peer_review: "Peer review",
  broadcast: "Broadcasts",
  analytics: "Analytics",
  blog: "Blog",
  leads: "Leads",
  lesson: "Lessons",
  assignment: "Assignments",
  marketplace: "Instructor marketplace",
  bundle: "Bundles",
  upsell: "Upsells",
  gift: "Gifts",
  item: "Prices",
  tax_rule: "Taxes",
  installments: "Installments",
  checkout_recovery: "Abandoned checkouts",
  team: "Teams",
  sequence: "Email sequences",
  message: "Messages",
  webhook: "Webhooks",
};

/** Human label for an action group ("peer_review" → "Peer review"). */
export function describeAuditGroup(group: string): string {
  return GROUP_LABELS[group] ?? humanize(group, "Other");
}

/** Human label for a target type ("legal_page" → "Legal page"). */
export function describeAuditTarget(type: string): string {
  return TARGET_LABELS[type] ?? humanize(type, "Other");
}

export interface AuditFacet {
  value: string;
  label: string;
  count: number;
}

export interface AuditFacets {
  /** Exact actions, grouped under their first segment ("course.*"). */
  groups: { value: string; label: string; count: number; actions: AuditFacet[] }[];
  targetTypes: AuditFacet[];
  /** Events per actor id; events without an actor are counted in `system`. */
  actors: Map<string, number>;
  system: number;
}

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

/** Values present in the log, with counts, for the filter menus. */
export function auditFacets(events: readonly AuditEvent[]): AuditFacets {
  const actions = new Map<string, number>();
  const targets = new Map<string, number>();
  const actors = new Map<string, number>();
  let system = 0;
  for (const e of events) {
    actions.set(e.action, (actions.get(e.action) ?? 0) + 1);
    if (e.targetType) targets.set(e.targetType, (targets.get(e.targetType) ?? 0) + 1);
    if (e.actorId) actors.set(e.actorId, (actors.get(e.actorId) ?? 0) + 1);
    else system++;
  }
  const groups = new Map<string, AuditFacet[]>();
  for (const [action, count] of actions) {
    const group = auditActionGroup(action);
    const list = groups.get(group) ?? [];
    list.push({ value: action, label: describeAuditAction(action), count });
    groups.set(group, list);
  }
  return {
    groups: [...groups.entries()]
      .map(([group, list]) => ({
        value: `${group}.*`,
        label: describeAuditGroup(group),
        count: list.reduce((n, a) => n + a.count, 0),
        actions: list.sort(byLabel),
      }))
      .sort(byLabel),
    targetTypes: [...targets.entries()].map(([value, count]) => ({ value, label: describeAuditTarget(value), count })).sort(byLabel),
    actors,
    system,
  };
}

/** Where each settings section is edited (`settings.update` targets). */
const SETTINGS_PATHS: Record<string, string> = {
  general: "/admin/settings/general",
  branding: "/admin/settings/branding",
  seo: "/admin/settings/seo",
  features: "/admin/settings/features",
  learning: "/admin/settings/learning",
  sidebar: "/admin/settings/sidebar",
  video: "/admin/settings/video",
  storage: "/admin/settings/storage",
  ai: "/admin/settings/ai",
  pwa: "/admin/settings/pwa",
  email: "/admin/settings/email",
  "email-tracking": "/admin/settings/email",
  security: "/admin/settings/security",
  gamification: "/admin/settings/gamification",
  payments: "/admin/settings/payments",
  legal: "/admin/settings/legal",
  data: "/admin/settings/data",
  api: "/admin/settings/api",
  growth: "/admin/settings/plans",
  "growth.affiliates": "/admin/affiliates",
};

function metaString(event: AuditEvent, key: string): string | null {
  const value = event.meta?.[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * Admin page for an event's target, or null when there is none (the target
 * was deleted by this very event, or its type has no page). `orderIdOf`
 * resolves a payment's order id for events that did not record it.
 */
export function auditTargetHref(event: AuditEvent, orderIdOf?: (paymentId: string) => string | undefined): string | null {
  const { targetType: type, targetId: id } = event;
  if (!type || !id) return null;
  const removed = /\.(delete|revoke)$/.test(event.action);
  const enc = encodeURIComponent;
  switch (type) {
    case "user":
      return event.action === "user.delete" ? null : `/admin/members/${enc(id)}`;
    case "course":
      return removed ? null : `/admin/courses/${enc(id)}`;
    case "batch":
      return `/admin/batches/${enc(id)}`;
    case "payment": {
      const orderId = metaString(event, "orderId") ?? orderIdOf?.(id);
      return removed || !orderId ? null : `/admin/settings/transactions?search=${enc(orderId)}`;
    }
    case "certificate": {
      const code = metaString(event, "code");
      return removed || !code ? null : `/certificates/${enc(code)}`;
    }
    case "legal_page": {
      const slug = metaString(event, "slug");
      return removed || !slug ? "/admin/settings/legal" : `/admin/settings/legal/${enc(slug)}`;
    }
    case "settings":
      return SETTINGS_PATHS[id] ?? "/admin/settings";
    case "affiliate":
      return "/admin/affiliates";
    case "ai_message":
      return "/admin/ai";
    case "transcode_job":
      return "/admin/settings/storage";
    case "error":
      return removed ? null : `/admin/errors/${enc(id)}`;
    case "rubric":
      return removed ? null : `/admin/rubrics/${enc(id)}`;
    case "assignment":
      return `/admin/assignments/${enc(id)}`;
    case "plan":
    case "subscription":
      return "/admin/settings/plans";
    case "api_key":
      return "/admin/settings/api";
    case "redirect":
      return "/admin/settings/seo/redirects";
    case "category":
      return "/admin/settings/categories";
    default:
      return null;
  }
}

/** Events recorded after `since` (for the "last 24 hours / 7 days" counters). */
export function countAuditEventsSince(events: readonly AuditEvent[], since: Date): number {
  const cutoff = since.getTime();
  let n = 0;
  for (const e of events) if (Date.parse(e.createdAt) >= cutoff) n++;
  return n;
}

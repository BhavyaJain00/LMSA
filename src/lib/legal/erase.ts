import type { Database, User } from "@/lib/types";

/**
 * "Delete my account" (GDPR right to erasure) as an anonymization.
 *
 * The user record stays, stripped of everything personal, so references from
 * the rest of the data keep working: discussion posts and reviews show
 * "Deleted user", course statistics and certificates' counts stay correct, and
 * orders keep their amounts and invoice numbers for the books (the billing
 * name, address and tax ids are removed). Everything that only serves the
 * person — sessions, tokens, notes, preferences, notifications, emails,
 * sign-in history, AI chats, leads and job applications — is removed.
 *
 * Pure (mutates the database object it is given) so it runs inside one
 * `mutate()` transaction and is unit tested directly.
 */

export const DELETED_USER_NAME = "Deleted user";
const DELETED_EMAIL_DOMAIN = "deleted.invalid";
/** Not a valid scrypt hash: no password ever matches it. */
export const DELETED_PASSWORD_HASH = "!deleted";

export function deletedEmailFor(userId: string): string {
  return `deleted-${userId.replace(/[^a-z0-9_-]/gi, "").toLowerCase()}@${DELETED_EMAIL_DOMAIN}`;
}

/** True once an account went through `eraseAccountInDb`. */
export function isDeletedAccount(user: Pick<User, "email">): boolean {
  return user.email.toLowerCase().endsWith(`@${DELETED_EMAIL_DOMAIN}`);
}

export interface ErasureSummary {
  /** Records removed per collection. */
  removed: Record<string, number>;
  /** Records kept but stripped of personal data, per collection. */
  anonymized: Record<string, number>;
}

/** Only the last enabled administrator cannot delete their account (someone must run the platform). */
export function isLastAdmin(db: Pick<Database, "users">, userId: string): boolean {
  const user = db.users.find((u) => u.id === userId);
  if (!user || !user.roles.includes("admin")) return false;
  return !db.users.some((u) => u.id !== userId && u.enabled && u.roles.includes("admin") && !isDeletedAccount(u));
}

/**
 * Anonymize `userId` in place. Returns null when the user does not exist.
 * `username` must be unique; the caller passes a fresh random handle.
 */
export function eraseAccountInDb(db: Database, userId: string, opts: { now: Date; username: string }): ErasureSummary | null {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return null;
  const email = user.email.trim().toLowerCase();
  const summary: ErasureSummary = { removed: {}, anonymized: {} };

  const drop = <T,>(name: string, rows: T[], predicate: (row: T) => boolean): T[] => {
    const keep = rows.filter((r) => !predicate(r));
    if (keep.length !== rows.length) summary.removed[name] = rows.length - keep.length;
    return keep;
  };
  const touched = (name: string, n = 1) => {
    summary.anonymized[name] = (summary.anonymized[name] ?? 0) + n;
  };
  const sameEmail = (value: string | undefined) => !!value && value.trim().toLowerCase() === email;

  // 1. The account itself: nothing personal left, cannot sign in again.
  const replacement: User = {
    id: user.id,
    username: opts.username,
    name: DELETED_USER_NAME,
    email: deletedEmailFor(user.id),
    passwordHash: DELETED_PASSWORD_HASH,
    roles: ["student"],
    enabled: false,
    personaCaptured: true,
    createdAt: user.createdAt,
    lastActiveAt: opts.now.toISOString(),
  };
  const index = db.users.findIndex((u) => u.id === userId);
  db.users[index] = replacement;
  touched("users");

  // 2. Things that only exist for the person.
  db.sessions = drop("sessions", db.sessions, (s) => s.userId === userId);
  db.authTokens = drop("authTokens", db.authTokens, (t) => t.userId === userId);
  db.notes = drop("notes", db.notes, (n) => n.userId === userId);
  db.notifications = drop("notifications", db.notifications, (n) => n.userId === userId);
  db.loginEvents = drop("loginEvents", db.loginEvents, (e) => e.userId === userId || sameEmail(e.email));
  db.emails = drop("emails", db.emails, (e) => e.userId === userId || sameEmail(e.to));
  db.leads = drop("leads", db.leads, (l) => sameEmail(l.email));
  db.jobApplications = drop("jobApplications", db.jobApplications, (a) => a.userId === userId);
  db.uploadSessions = drop("uploadSessions", db.uploadSessions, (u) => u.userId === userId && u.status === "uploading");
  db.checkoutSessions = drop("checkoutSessions", db.checkoutSessions, (c) => c.userId === userId || sameEmail(c.email));
  db.sequenceEnrollments = drop("sequenceEnrollments", db.sequenceEnrollments, (s) => s.userId === userId || sameEmail(s.email));
  const aiConversationIds = new Set(db.aiConversations.filter((c) => c.userId === userId).map((c) => c.id));
  db.aiMessages = drop("aiMessages", db.aiMessages, (m) => aiConversationIds.has(m.conversationId));
  db.aiConversations = drop("aiConversations", db.aiConversations, (c) => c.userId === userId);
  db.evaluatorSlots = drop("evaluatorSlots", db.evaluatorSlots, (s) => s.evaluatorId === userId);

  // 3. Records kept for others or for the books, without personal data.
  for (const p of db.payments) {
    if (p.userId !== userId) continue;
    p.billingName = DELETED_USER_NAME;
    delete p.address;
    delete p.gstin;
    delete p.pan;
    delete p.source;
    delete p.checkoutUrl;
    // An unpaid order can never be completed now; stop it reserving coupon uses.
    if (p.status === "pending") p.status = "failed";
    touched("payments");
  }
  for (const c of db.consents) {
    if (c.userId !== userId) continue;
    delete c.userId;
    touched("consents");
  }
  for (const e of db.analyticsEvents) {
    if (e.userId !== userId) continue;
    delete e.userId;
    touched("analyticsEvents");
  }
  for (const e of db.errorEvents) {
    if (e.userId !== userId) continue;
    delete e.userId;
    touched("errorEvents");
  }
  for (const seat of db.orgSeats) {
    if (seat.userId !== userId && !sameEmail(seat.email)) continue;
    seat.email = replacement.email;
    delete seat.inviteTokenHash;
    if (seat.status !== "revoked") seat.status = "revoked";
    touched("orgSeats");
  }
  for (const g of db.gifts) {
    if (!sameEmail(g.recipientEmail) || g.redeemedAt) continue;
    // An unredeemed gift addressed to this person keeps its code; only the address goes.
    g.recipientEmail = replacement.email;
    delete g.recipientName;
    touched("gifts");
  }
  for (const a of db.affiliates) {
    if (a.userId !== userId) continue;
    delete a.payoutEmail;
    a.status = "paused";
    touched("affiliates");
  }
  for (const profile of db.instructorProfiles) {
    if (profile.userId !== userId) continue;
    delete profile.payoutEmail;
    delete profile.application;
    touched("instructorProfiles");
  }
  for (const org of db.organizations) {
    if (!org.managerIds.includes(userId)) continue;
    org.managerIds = org.managerIds.filter((id) => id !== userId);
    touched("organizations");
  }
  for (const lc of db.liveClasses) {
    if (!lc.attendeeIds.includes(userId)) continue;
    lc.attendeeIds = lc.attendeeIds.filter((id) => id !== userId);
    touched("liveClasses");
  }
  for (const s of db.subscriptions) {
    if (s.userId !== userId || s.status === "cancelled" || s.status === "expired") continue;
    s.status = "cancelled";
    s.cancelAtPeriodEnd = true;
    s.updatedAt = opts.now.toISOString();
    touched("subscriptions");
  }

  return summary;
}

/**
 * Memberships still billed by a payment gateway. Deleting the account would
 * leave the gateway charging a person who no longer has an account, so the
 * member must cancel these first.
 */
export function billedSubscriptions(db: Pick<Database, "subscriptions">, userId: string): Database["subscriptions"] {
  return db.subscriptions.filter(
    (s) => s.userId === userId && !!s.gatewaySubscriptionId && s.gateway !== "manual" && (s.status === "active" || s.status === "trialing" || s.status === "past_due") && !s.cancelAtPeriodEnd,
  );
}

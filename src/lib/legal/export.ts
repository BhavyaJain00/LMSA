import type { CollectionName, Conversation, Database, DirectMessage, User } from "@/lib/types";

/**
 * "Download my data" (GDPR right of access / portability).
 *
 * `personalDataSections(db, userId)` collects everything linked to one member
 * across every collection, minus secrets (password hash, 2FA material,
 * token hashes, API key hashes, resumable checkout links, bodies of one-time
 * link emails) and minus other people's identities where the member only
 * appears as the subject (who reviewed their work, which admin acted on them).
 * `serializePersonalData` turns the sections into JSON chunk by chunk so the
 * route can stream a large export without building one giant string.
 *
 * Pure: no server imports, so it is unit tested directly.
 */

export const EXPORT_FORMAT = "learnloop.personal-data";
export const EXPORT_VERSION = 1;

type Row = Record<string, unknown>;

export interface ExportSection {
  /** JSON key, e.g. "enrollments". */
  key: string;
  /** Human description written into the export's table of contents. */
  description: string;
  rows: Row[];
}

/** Fields of the user record that are never exported. */
export const USER_SECRET_FIELDS = [
  "passwordHash",
  "twoFactorSecretEnc",
  "twoFactorLastStep",
  "recoveryCodeHashes",
  "calendarToken",
  "failedLoginCount",
  "lockedUntil",
] as const;

/** Email categories whose bodies carry one-time links (only metadata is exported). */
const ONE_TIME_LINK_CATEGORIES = new Set(["password_reset", "email_verification"]);

function omit(row: object, fields: readonly string[]): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) if (!fields.includes(key)) out[key] = value;
  return out;
}

function rowsOf(db: Database, name: CollectionName): Row[] {
  return (db[name] as unknown as Row[]) ?? [];
}

/** Collections whose rows carry the member's id in `userId`, exported as they are. */
const BY_USER_ID: { name: CollectionName; description: string; omit?: string[] }[] = [
  { name: "enrollments", description: "Courses you are enrolled in" },
  { name: "progress", description: "Lesson completion" },
  { name: "videoWatches", description: "Video watch progress" },
  { name: "notes", description: "Your lesson notes" },
  { name: "reviews", description: "Course reviews you wrote" },
  { name: "quizSubmissions", description: "Quiz attempts and answers" },
  { name: "quizViolations", description: "Proctoring events recorded during quizzes" },
  { name: "assignmentSubmissions", description: "Assignment submissions and feedback", omit: ["evaluatorId"] },
  { name: "batchEnrollments", description: "Batches you joined" },
  { name: "batchFeedback", description: "Feedback you gave on batches" },
  { name: "programMembers", description: "Programs you joined" },
  { name: "certificates", description: "Certificates issued to you", omit: ["evaluatorId"] },
  { name: "certificateRequests", description: "Evaluation requests", omit: ["evaluatorId"] },
  { name: "certificateEvaluations", description: "Evaluation results", omit: ["evaluatorId"] },
  { name: "badgeAssignments", description: "Badges you earned" },
  { name: "activities", description: "Learning activity (streaks)" },
  { name: "points", description: "Points ledger" },
  { name: "notifications", description: "In-app notifications", omit: ["dedupeKey"] },
  { name: "jobApplications", description: "Job applications" },
  { name: "subscriptions", description: "Memberships" },
  { name: "uploadSessions", description: "Files you uploaded", omit: ["storageKey"] },
  { name: "instructorProfiles", description: "Instructor application and profile" },
  { name: "aiConversations", description: "AI teaching assistant conversations" },
  { name: "consents", description: "Cookie consent decisions" },
  { name: "dataRequests", description: "Data export and deletion requests" },
  { name: "analyticsEvents", description: "Pages and actions recorded while you were signed in", omit: ["anonId"] },
];

/** Content a member created, listed by id and title only (the content itself belongs to the platform). */
const AUTHORED: { name: CollectionName; by: (row: Row, userId: string) => boolean; title: (row: Row) => string }[] = [
  { name: "courses", by: (r, id) => r.createdById === id || (Array.isArray(r.instructorIds) && r.instructorIds.includes(id)), title: (r) => String(r.title ?? "") },
  { name: "batches", by: (r, id) => r.createdById === id || (Array.isArray(r.instructorIds) && r.instructorIds.includes(id)), title: (r) => String(r.title ?? "") },
  { name: "programs", by: (r, id) => r.createdById === id, title: (r) => String(r.title ?? "") },
  { name: "blogPosts", by: (r, id) => r.authorId === id, title: (r) => String(r.title ?? "") },
  { name: "quizzes", by: (r, id) => r.authorId === id, title: (r) => String(r.title ?? "") },
  { name: "questions", by: (r, id) => r.authorId === id, title: (r) => String(r.text ?? "").slice(0, 120) },
  { name: "assignments", by: (r, id) => r.authorId === id, title: (r) => String(r.title ?? "") },
  { name: "exercises", by: (r, id) => r.authorId === id, title: (r) => String(r.title ?? "") },
  { name: "announcements", by: (r, id) => r.authorId === id, title: (r) => String(r.subject ?? "") },
  { name: "jobs", by: (r, id) => r.postedById === id, title: (r) => String(r.title ?? "") },
  { name: "liveClasses", by: (r, id) => r.hostId === id, title: (r) => String(r.title ?? "") },
  { name: "broadcasts", by: (r, id) => r.createdById === id, title: (r) => String(r.subject ?? "") },
  { name: "rubrics", by: (r, id) => r.createdById === id, title: (r) => String(r.title ?? "") },
  { name: "lessonVersions", by: (r, id) => r.savedById === id, title: (r) => String(r.title ?? "") },
];

function sameEmail(value: unknown, email: string): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === email;
}

/** The member's profile without secrets. */
export function exportableUser(user: User): Row {
  return omit(user, USER_SECRET_FIELDS);
}

/**
 * Receives each section as its source rows (already filtered to the member)
 * plus the function that turns one row into its exported form. The export
 * maps every row; the privacy page only counts them.
 */
type SectionSink = <T extends object>(key: string, description: string, rows: readonly T[], map: (row: T) => Row) => void;

const copy = (row: object): Row => ({ ...row });

/**
 * A conversation as one participant may see it. Report details (who reported
 * it, why, which moderator closed the report) are moderation data: they are
 * included only for the member who filed the report, never for the person
 * who was reported.
 */
export function exportableConversation(c: Conversation, userId: string): Row {
  const row: Row = { id: c.id, participantIds: [...c.participantIds] };
  if (c.courseId !== undefined) row.courseId = c.courseId;
  if (c.subject !== undefined) row.subject = c.subject;
  row.createdAt = c.createdAt;
  row.lastMessageAt = c.lastMessageAt;
  if (c.reportedBy === userId) {
    row.reportedByYou = true;
    if (c.reportedAt !== undefined) row.reportedAt = c.reportedAt;
    if (c.reportReason !== undefined) row.reportReason = c.reportReason;
    if (c.reportedMessageId !== undefined) row.reportedMessageId = c.reportedMessageId;
    if (c.reportResolvedAt !== undefined) row.reportResolvedAt = c.reportResolvedAt;
  }
  return row;
}

/** A direct message without the id of a moderator who removed it (the member's own removals keep it). */
export function exportableDirectMessage(m: DirectMessage, userId: string): Row {
  return m.removedBy !== undefined && m.removedBy !== userId ? omit(m, ["removedBy"]) : { ...m };
}

/**
 * Every section of the export for `userId` (empty sections included, so the
 * file shows what was checked). Returns null when the user does not exist.
 */
export function personalDataSections(db: Database, userId: string): ExportSection[] | null {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return null;
  const sections: ExportSection[] = [];
  collectPersonalData(db, user, (key, description, rows, map) => sections.push({ key, description, rows: rows.map(map) }));
  return sections;
}

/**
 * Number of records per section, using the same rules as the export but
 * without copying any row (for the privacy page). Null when the user does not exist.
 */
export function countPersonalData(db: Database, userId: string): { key: string; description: string; count: number }[] | null {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return null;
  const counts: { key: string; description: string; count: number }[] = [];
  collectPersonalData(db, user, (key, description, rows) => counts.push({ key, description, count: rows.length }));
  return counts;
}

function collectPersonalData(db: Database, user: User, add: SectionSink): void {
  const userId = user.id;
  const email = user.email.trim().toLowerCase();

  add("account", "Your profile and account settings", [user], exportableUser);
  add(
    "sessions",
    "Devices currently signed in",
    db.sessions.filter((s) => s.userId === userId),
    (s) => omit(s, ["tokenHash"]),
  );
  add(
    "loginEvents",
    "Sign-in history",
    db.loginEvents.filter((e) => e.userId === userId || sameEmail(e.email, email)),
    copy,
  );
  add(
    "authTokens",
    "Password-reset, email-confirmation and sign-in codes issued (the codes themselves are never stored)",
    db.authTokens.filter((t) => t.userId === userId),
    (t) => omit(t, ["tokenHash"]),
  );

  for (const spec of BY_USER_ID) {
    add(
      spec.name,
      spec.description,
      rowsOf(db, spec.name).filter((r) => r.userId === userId),
      (r) => (spec.omit ? omit(r, spec.omit) : { ...r }),
    );
  }

  // Exercise results: never reveal the inputs/expected outputs of hidden tests.
  let hiddenTests: Set<string> | undefined;
  const isHiddenTest = (exerciseId: string, testCaseId: string) =>
    (hiddenTests ??= new Set(db.exercises.flatMap((e) => e.testCases.filter((t) => t.hidden).map((t) => `${e.id}:${t.id}`)))).has(`${exerciseId}:${testCaseId}`);
  add(
    "exerciseSubmissions",
    "Programming exercise submissions",
    db.exerciseSubmissions.filter((s) => s.userId === userId),
    (s) => ({
      ...s,
      testResults: s.testResults.map((r) => (isHiddenTest(s.exerciseId, r.testCaseId) ? omit(r, ["input", "expectedOutput"]) : { ...r })),
    }),
  );

  add(
    "payments",
    "Orders, invoices and refunds",
    db.payments.filter((p) => p.userId === userId),
    (p) => omit(p, ["checkoutUrl"]),
  );
  const myEmails = db.emails.filter((e) => e.userId === userId || sameEmail(e.to, email));
  add(
    "emails",
    "Emails sent to you (bodies of password-reset and confirmation emails are left out)",
    myEmails,
    (e) => (ONE_TIME_LINK_CATEGORIES.has(e.category) ? omit(e, ["html", "text"]) : omit(e, ["html"])),
  );
  const myEmailIds = new Set(myEmails.map((e) => e.id));
  add(
    "emailEvents",
    "Opens and clicks recorded for those emails",
    db.emailEvents.filter((e) => myEmailIds.has(e.emailId)),
    copy,
  );

  add("discussionTopics", "Discussion threads you started", db.discussionTopics.filter((t) => t.authorId === userId), copy);
  add("discussionReplies", "Discussion replies you posted", db.discussionReplies.filter((r) => r.authorId === userId), copy);

  const conversations = db.conversations.filter((c) => c.participantIds.includes(userId));
  const conversationIds = new Set(conversations.map((c) => c.id));
  add("conversations", "Direct-message conversations you take part in", conversations, (c) => exportableConversation(c, userId));
  add(
    "directMessages",
    "Messages in those conversations",
    db.directMessages.filter((m) => conversationIds.has(m.conversationId)),
    (m) => exportableDirectMessage(m, userId),
  );

  const aiConversationIds = new Set(db.aiConversations.filter((c) => c.userId === userId).map((c) => c.id));
  add("aiMessages", "Questions you asked the AI teaching assistant and its answers", db.aiMessages.filter((m) => aiConversationIds.has(m.conversationId)), copy);

  add("peerReviewsGiven", "Peer reviews you wrote", db.peerReviews.filter((r) => r.reviewerId === userId), copy);
  const mySubmissionIds = new Set(db.assignmentSubmissions.filter((s) => s.userId === userId).map((s) => s.id));
  add(
    "peerReviewsReceived",
    "Peer reviews of your submissions (reviewers are anonymous)",
    db.peerReviews.filter((r) => mySubmissionIds.has(r.submissionId) && r.status === "submitted"),
    (r) => omit(r, ["reviewerId"]),
  );

  add(
    "liveClassAttendance",
    "Live classes you attended",
    db.liveClasses.filter((l) => l.attendeeIds.includes(userId)),
    (l) => ({ id: l.id, batchId: l.batchId, title: l.title, date: l.date, time: l.time, timezone: l.timezone }),
  );
  add("evaluatorSlots", "Your evaluation availability", db.evaluatorSlots.filter((s) => s.evaluatorId === userId), copy);

  add("leads", "Newsletter and lead-magnet sign-ups made with your email", db.leads.filter((l) => sameEmail(l.email, email)), copy);
  add(
    "checkoutSessions",
    "Checkouts you started",
    db.checkoutSessions.filter((c) => c.userId === userId || sameEmail(c.email, email)),
    copy,
  );
  add(
    "sequenceEnrollments",
    "Automatic email sequences you receive",
    db.sequenceEnrollments.filter((s) => s.userId === userId || sameEmail(s.email, email)),
    copy,
  );
  add(
    "gifts",
    "Gifts you bought, received or redeemed",
    db.gifts.filter((g) => g.purchaserId === userId || g.redeemedBy === userId || sameEmail(g.recipientEmail, email)),
    copy,
  );

  const affiliates = db.affiliates.filter((a) => a.userId === userId);
  const affiliateIds = new Set(affiliates.map((a) => a.id));
  add("affiliates", "Your affiliate account", affiliates, copy);
  add(
    "affiliateReferrals",
    "Visits referred by your affiliate links (visitor ids left out)",
    db.affiliateReferrals.filter((r) => affiliateIds.has(r.affiliateId)),
    (r) => omit(r, ["visitorId"]),
  );
  add("commissions", "Affiliate commissions", db.commissions.filter((c) => affiliateIds.has(c.affiliateId)), copy);
  add("earnings", "Instructor earnings", db.earnings.filter((e) => e.instructorId === userId), copy);
  add(
    "payouts",
    "Payouts to you",
    db.payouts.filter((p) => p.instructorId === userId || (p.affiliateId !== undefined && affiliateIds.has(p.affiliateId))),
    copy,
  );

  add(
    "organizations",
    "Teams you own or manage",
    db.organizations.filter((o) => o.ownerId === userId || o.managerIds.includes(userId)),
    copy,
  );
  add(
    "orgSeats",
    "Team seats assigned to you",
    db.orgSeats.filter((s) => s.userId === userId || sameEmail(s.email, email)),
    (s) => omit(s, ["inviteTokenHash"]),
  );
  add(
    "apiKeys",
    "API keys you created (the keys themselves are never stored)",
    db.apiKeys.filter((k) => k.createdById === userId),
    (k) => omit(k, ["keyHash"]),
  );

  add("auditEventsByYou", "Administrative actions you performed", db.auditEvents.filter((e) => e.actorId === userId), copy);
  add(
    "auditEventsAboutYou",
    "Administrative actions that concerned your account",
    db.auditEvents.filter((e) => e.actorId !== userId && e.targetType === "user" && e.targetId === userId),
    (e) => ({ id: e.id, action: e.action, createdAt: e.createdAt }),
  );
  add(
    "errorReports",
    "Errors that happened while you were using the site",
    db.errorEvents.filter((e) => e.userId === userId),
    (e) => ({ id: e.id, message: e.message, path: e.path, count: e.count, createdAt: e.createdAt, lastSeenAt: e.lastSeenAt }),
  );

  add(
    "authoredContent",
    "Content you created or teach (listed by title; the content stays on the platform)",
    AUTHORED.flatMap((spec) => rowsOf(db, spec.name).filter((r) => spec.by(r, userId)).map((r) => ({ type: spec.name, id: r.id, title: spec.title(r) }))),
    copy,
  );
}

/** Number of records per section (shown on the privacy page and stored with the request). */
export function summarizeSections(sections: ExportSection[]): { key: string; description: string; count: number }[] {
  return sections.map((s) => ({ key: s.key, description: s.description, count: s.rows.length }));
}

/** `JSON.stringify(value, null, 2)` with every line after the first indented by `spaces`. */
function indentJson(value: unknown, spaces: number): string {
  return JSON.stringify(value, null, 2).replace(/\n/g, `\n${" ".repeat(spaces)}`);
}

/**
 * Serialize an export as pretty JSON, one chunk per record, so a stream can
 * send it without holding the whole document as one string. The result is a
 * single valid JSON document.
 */
export function* serializePersonalData(sections: ExportSection[], meta: { exportedAt: string; siteName: string; siteUrl: string }): Generator<string> {
  yield "{\n";
  yield `  "format": ${JSON.stringify(EXPORT_FORMAT)},\n`;
  yield `  "version": ${EXPORT_VERSION},\n`;
  yield `  "exportedAt": ${JSON.stringify(meta.exportedAt)},\n`;
  yield `  "site": ${JSON.stringify({ name: meta.siteName, url: meta.siteUrl })},\n`;
  yield `  "contents": ${indentJson(summarizeSections(sections), 2)},\n`;
  yield '  "data": {';
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]!;
    yield `${si ? "," : ""}\n    ${JSON.stringify(section.key)}: [`;
    for (let ri = 0; ri < section.rows.length; ri++) {
      yield `${ri ? "," : ""}\n      ${indentJson(section.rows[ri], 6)}`;
    }
    yield section.rows.length ? "\n    ]" : "]";
  }
  yield "\n  }\n}\n";
}

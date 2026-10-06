import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Conversation, DirectMessage, User } from "@/lib/types";
import {
  DENY_MESSAGES,
  MESSAGE_LIMITS,
  REPLY_BLOCKED_MESSAGES,
  MESSAGE_RATES,
  buildMessagingDirectory,
  canReply,
  cleanLine,
  countUnread,
  decideMessaging,
  findDirectConversation,
  isMessagingStaff,
  lastSeenOwnMessageId,
  matchesInboxSearch,
  messagePreview,
  normalizeMessageBody,
  parseInline,
  parseMessageBody,
  reportStatus,
  safeMessageUrl,
  startsUnreadRun,
  threadAccess,
  type DirectorySource,
  type MessagingMember,
  type ReplyContext,
} from "@/lib/comms/messages-core";
import {
  buildThread,
  countUnreadMessages,
  listInbox,
  listReports,
  lookupRecipient,
  markConversationRead,
  messageLinkFor,
  pollThread,
  removeMessage,
  reportConversation,
  reportCsvRows,
  resetMessageRateLimits,
  resolveReport,
  searchRecipients,
  sendMessage,
  startConversation,
} from "@/lib/comms/messages";
import { getDb, mutate } from "@/lib/db/store";
import { makeBatch, makeCourse, makeEnrollment, makeUser, resetDb } from "./helpers/db";

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

const ON = { enabled: true, studentToStudent: false };
const PEERS = { enabled: true, studentToStudent: true };
const m = (id: string, roles: MessagingMember["roles"] = ["student"], enabled = true): MessagingMember => ({ id, roles, enabled });

const source: DirectorySource = {
  courses: [
    { id: "c1", instructorIds: ["teacher"], evaluatorId: "grader" },
    { id: "c2", instructorIds: ["other-teacher"] },
  ],
  batches: [{ id: "b1", instructorIds: ["batch-teacher"] }],
  enrollments: [
    { userId: "ann", courseId: "c1" },
    { userId: "bob", courseId: "c1" },
    { userId: "cat", courseId: "c2" },
  ],
  batchEnrollments: [{ userId: "dan", batchId: "b1" }],
};
const dir = buildMessagingDirectory(source);

describe("message permissions", () => {
  it("lets learners message the instructors and evaluators of their courses and batches", () => {
    assert.deepEqual(decideMessaging(ON, m("ann"), m("teacher"), dir), { ok: true, via: "instructor", courseId: "c1" });
    assert.deepEqual(decideMessaging(ON, m("ann"), m("grader"), dir), { ok: true, via: "instructor", courseId: "c1" });
    assert.deepEqual(decideMessaging(ON, m("dan"), m("batch-teacher"), dir), { ok: true, via: "instructor", courseId: undefined });
  });

  it("refuses instructors of courses the learner does not take", () => {
    assert.deepEqual(decideMessaging(ON, m("ann"), m("other-teacher"), dir), { ok: false, reason: "not_allowed" });
    assert.deepEqual(decideMessaging(ON, m("cat"), m("teacher"), dir), { ok: false, reason: "not_allowed" });
  });

  it("only allows learner-to-learner messages between classmates and when the setting is on", () => {
    assert.deepEqual(decideMessaging(ON, m("ann"), m("bob"), dir), { ok: false, reason: "students_off" });
    assert.deepEqual(decideMessaging(PEERS, m("ann"), m("bob"), dir), { ok: true, via: "classmate", courseId: "c1" });
    assert.deepEqual(decideMessaging(PEERS, m("ann"), m("cat"), dir), { ok: false, reason: "not_allowed" }, "no shared course");
  });

  it("lets instructors and moderators message any member", () => {
    assert.deepEqual(decideMessaging(ON, m("teacher"), m("ann"), dir), { ok: true, via: "staff", courseId: "c1" });
    assert.deepEqual(decideMessaging(ON, m("teacher"), m("cat"), dir), { ok: true, via: "staff", courseId: undefined });
    assert.equal(decideMessaging(ON, m("mod", ["moderator"]), m("cat"), dir).ok, true);
    assert.equal(decideMessaging(ON, m("creator", ["course_creator"]), m("cat"), dir).ok, true);
    assert.ok(isMessagingStaff(m("batch-teacher"), dir), "teaching a batch makes a student-role member an instructor");
    assert.ok(!isMessagingStaff(m("ann"), dir));
  });

  it("applies the global switch, self-messages and disabled accounts first", () => {
    assert.deepEqual(decideMessaging({ enabled: false, studentToStudent: true }, m("mod", ["admin"]), m("ann"), dir), { ok: false, reason: "disabled" });
    assert.deepEqual(decideMessaging(ON, m("teacher"), m("teacher"), dir), { ok: false, reason: "self" });
    assert.deepEqual(decideMessaging(ON, m("ann"), m("teacher", ["student"], false), dir), { ok: false, reason: "unavailable" });
    assert.deepEqual(decideMessaging(ON, m("ann", ["student"], false), m("teacher"), dir), { ok: false, reason: "unavailable" });
    for (const reason of Object.keys(DENY_MESSAGES)) assert.ok(DENY_MESSAGES[reason as keyof typeof DENY_MESSAGES].length > 10);
  });

  it("prefers the requested course as the conversation context when both share it", () => {
    const d = buildMessagingDirectory({ ...source, enrollments: [...source.enrollments, { userId: "ann", courseId: "c3" }], courses: [...source.courses, { id: "c3", instructorIds: ["teacher"] }] });
    assert.equal((decideMessaging(ON, m("ann"), m("teacher"), d, "c3") as { courseId?: string }).courseId, "c3");
    assert.equal((decideMessaging(ON, m("ann"), m("teacher"), d, "c2") as { courseId?: string }).courseId, "c1", "an unrelated course is ignored");
  });

  const ctx = (over: Partial<ReplyContext> = {}): ReplyContext => ({
    isEnabled: () => true,
    isStaff: (id) => isMessagingStaff(m(id, id === "mod" ? ["moderator"] : ["student"]), dir),
    areClassmates: (a, b) => [...(dir.learning.get(a) ?? [])].some((k) => dir.learning.get(b)?.has(k)),
    ...over,
  });

  it("lets any participant reply while messaging is on and someone else is still active", () => {
    const conversation = { participantIds: ["ann", "teacher"] };
    assert.equal(canReply(ON, conversation, m("ann"), ctx()).ok, true, "a learner can answer an instructor who wrote first");
    assert.deepEqual(canReply(ON, conversation, m("eve"), ctx()), { ok: false, reason: "not_allowed" });
    assert.deepEqual(canReply(ON, conversation, m("ann"), ctx({ isEnabled: () => false })), { ok: false, reason: "unavailable" });
    assert.deepEqual(canReply({ enabled: false, studentToStudent: true }, conversation, m("ann"), ctx()), { ok: false, reason: "disabled" });
  });

  it("applies the learner-to-learner rule to existing conversations too", () => {
    const peers = { participantIds: ["ann", "bob"] };
    assert.deepEqual(canReply(PEERS, peers, m("ann"), ctx()), { ok: true, via: "classmate" });
    assert.deepEqual(canReply(ON, peers, m("ann"), ctx()), { ok: false, reason: "students_off" }, "switching the setting off stops old conversations");
    assert.deepEqual(canReply(PEERS, { participantIds: ["ann", "cat"] }, m("ann"), ctx()), { ok: false, reason: "not_allowed" }, "no shared course any more");
    assert.equal(canReply(ON, { participantIds: ["cat", "mod"] }, m("cat"), ctx()).ok, true, "conversations with staff stay open");
    assert.equal(canReply(ON, { participantIds: ["ann", "teacher"] }, m("teacher"), ctx()).ok, true);
  });

  it("shows threads to participants, and to moderators only once reported", () => {
    const c = { participantIds: ["ann", "teacher"] } as Pick<Conversation, "participantIds" | "reportedAt">;
    assert.equal(threadAccess(c, { id: "ann", roles: ["student"] }), "participant");
    assert.equal(threadAccess(c, { id: "mod", roles: ["moderator"] }), null);
    assert.equal(threadAccess({ ...c, reportedAt: "2026-01-01T00:00:00.000Z" }, { id: "mod", roles: ["moderator"] }), "moderator");
    assert.equal(threadAccess({ ...c, reportedAt: "2026-01-01T00:00:00.000Z" }, { id: "creator", roles: ["course_creator"] }), null);
  });

  it("finds the latest one-to-one conversation between two members", () => {
    const list = [
      { id: "a", participantIds: ["x", "y"], lastMessageAt: "2026-01-01" },
      { id: "b", participantIds: ["y", "x"], lastMessageAt: "2026-02-01" },
      { id: "g", participantIds: ["x", "y", "z"], lastMessageAt: "2026-03-01" },
    ];
    assert.equal(findDirectConversation(list, "x", "y")?.id, "b");
    assert.equal(findDirectConversation(list, "x", "z"), undefined);
  });
});

describe("message bodies and read state", () => {
  it("normalizes and validates bodies", () => {
    assert.deepEqual(normalizeMessageBody("  Hi\r\nthere \u0007‮\n\n\n\n\nbye  "), { ok: true, body: "Hi\nthere\n\n\nbye" });
    assert.equal(normalizeMessageBody("   \n ").ok, false);
    assert.equal(normalizeMessageBody(42).ok, false);
    assert.equal(normalizeMessageBody("x".repeat(MESSAGE_LIMITS.bodyMax)).ok, true);
    const long = normalizeMessageBody("x".repeat(MESSAGE_LIMITS.bodyMax + 1));
    assert.equal(long.ok, false);
    assert.match((long as { error: string }).error, /4,000/);
    assert.equal(cleanLine("  Spam\n\tand   more ", 9), "Spam and");
  });

  it("counts unread messages and finds the read receipt", () => {
    const msgs: Pick<DirectMessage, "id" | "senderId" | "readBy" | "removedAt">[] = [
      { id: "1", senderId: "a", readBy: ["a", "b"] },
      { id: "2", senderId: "a", readBy: ["a", "b"] },
      { id: "3", senderId: "a", readBy: ["a"] },
      { id: "4", senderId: "b", readBy: ["b"] },
      { id: "5", senderId: "b", readBy: ["b"], removedAt: "2026-01-01" },
    ];
    assert.equal(countUnread(msgs, "b"), 1);
    assert.equal(countUnread(msgs, "a"), 1, "removed messages are not news");
    assert.equal(lastSeenOwnMessageId(msgs, "a", ["a", "b"]), "2");
    assert.equal(lastSeenOwnMessageId(msgs, "b", ["a", "b"]), null);
    assert.equal(lastSeenOwnMessageId(msgs, "a", ["a"]), null);
    assert.equal(startsUnreadRun(msgs.slice(0, 2), "b"), true);
    assert.equal(startsUnreadRun(msgs, "b"), false, "a burst of messages emails once");
  });

  it("builds inbox previews and matches searches", () => {
    assert.equal(messagePreview("**Hi** _there_, see [the doc](https://x.io)\n- `npm i`\n```\ncode\n```"), "Hi there, see the doc npm i [code]");
    assert.equal(messagePreview("a".repeat(200), 10), "aaaaaaaaa…");
    assert.ok(matchesInboxSearch(["Maya Chen", undefined], "chen"));
    assert.ok(matchesInboxSearch(["x"], "  "));
    assert.ok(!matchesInboxSearch(["Maya"], "bob"));
    assert.equal(reportStatus({ reported: true, reportedAt: "x" }), "open");
    assert.equal(reportStatus({ reported: false, reportedAt: "x" }), "resolved");
    assert.equal(reportStatus({}), null);
  });

  it("allows only http(s) and mailto links", () => {
    assert.equal(safeMessageUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
    assert.equal(safeMessageUrl("mailto:ann@example.com"), "mailto:ann@example.com");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "https://user:pw@example.com", "//evil.com", "/relative", "https://exa mple.com", "vbscript:x"]) {
      assert.equal(safeMessageUrl(bad), null, bad);
    }
  });

  it("parses markdown-lite inline formatting", () => {
    assert.deepEqual(parseInline("a **b** *c* _d_ ~~e~~ `f*g*`"), [
      { t: "text", v: "a " },
      { t: "strong", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "d" }] },
      { t: "text", v: " " },
      { t: "del", c: [{ t: "text", v: "e" }] },
      { t: "text", v: " " },
      { t: "code", v: "f*g*" },
    ]);
    assert.deepEqual(parseInline("see https://example.com/x)."), [
      { t: "text", v: "see " },
      { t: "link", href: "https://example.com/x", c: [{ t: "text", v: "https://example.com/x" }] },
      { t: "text", v: ")." },
    ]);
    assert.deepEqual(parseInline("[click](javascript:alert(1))"), [{ t: "text", v: "[click](javascript:alert(1))" }], "unsafe links stay text");
    assert.deepEqual(parseInline("2*3*4 and snake_case_name"), [{ t: "text", v: "2*3*4 and snake_case_name" }], "intra-word markers are not emphasis");
    assert.deepEqual(parseInline("<b>hi</b>\nnext"), [{ t: "text", v: "<b>hi</b>" }, { t: "br" }, { t: "text", v: "next" }], "HTML stays text");
  });

  it("parses blocks: paragraphs, lists, quotes and fenced code", () => {
    const blocks = parseMessageBody("Hello\nworld\n\n- one\n- **two**\n> quoted\n```\nconst x = 1;\n```\nend");
    assert.deepEqual(
      blocks.map((b) => b.t),
      ["p", "ul", "quote", "pre", "p"],
    );
    assert.deepEqual(blocks[0], { t: "p", c: [{ t: "text", v: "Hello" }, { t: "br" }, { t: "text", v: "world" }] });
    assert.equal((blocks[1] as { items: unknown[] }).items.length, 2);
    assert.deepEqual(blocks[3], { t: "pre", v: "const x = 1;" });
    assert.deepEqual(parseMessageBody("```\nunclosed"), [{ t: "p", c: [{ t: "text", v: "```" }, { t: "br" }, { t: "text", v: "unclosed" }] }]);
  });
});

/* ------------------------------------------------------------------ */
/* Server: conversations, notifications, moderation                    */
/* ------------------------------------------------------------------ */

const teacher = makeUser({ id: "usr_teacher", username: "teacher", name: "Tina Teacher", email: "tina@example.com", roles: ["course_creator"] });
const ann = makeUser({ id: "usr_ann", username: "ann", name: "Ann Learner", email: "ann@example.com" });
const bob = makeUser({ id: "usr_bob", username: "bob", name: "Bob Learner", email: "bob@example.com" });
const cat = makeUser({ id: "usr_cat", username: "cat", name: "Cat Outsider", email: "cat@example.com" });
const mod = makeUser({ id: "usr_mod", username: "mod", name: "Moe Moderator", email: "mod@example.com", roles: ["moderator"] });
const course = makeCourse({ id: "crs_dm", title: "Watercolor Basics", instructorIds: [teacher.id] });

async function seed(settings: { studentToStudent?: boolean; enabled?: boolean } = {}) {
  resetMessageRateLimits();
  await resetDb({
    users: [teacher, ann, bob, cat, mod],
    courses: [course],
    batches: [makeBatch({ id: "bat_dm", instructorIds: [] })],
    enrollments: [makeEnrollment({ userId: ann.id, courseId: course.id }), makeEnrollment({ userId: bob.id, courseId: course.id })],
    settings: { messaging: { enabled: settings.enabled ?? true, studentToStudent: settings.studentToStudent ?? false } },
  });
}

async function user(id: string): Promise<User> {
  return (await getDb()).users.find((u) => u.id === id)!;
}

async function start(from: User, to: User, body = "Hello there") {
  const result = await startConversation(from, { recipientId: to.id, body });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result;
}

describe("starting and replying", () => {
  beforeEach(() => seed());

  it("starts a conversation with an instructor, notifies them and emails a copy", async () => {
    const result = await start(ann, teacher, "Question about **week 2**");
    assert.equal(result.created, true);
    const db = await getDb();
    const conversation = db.conversations.find((c) => c.id === result.conversationId)!;
    assert.deepEqual(conversation.participantIds, [ann.id, teacher.id]);
    assert.equal(conversation.courseId, course.id);
    const notes = db.notifications.filter((n) => n.userId === teacher.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].type, "system");
    assert.equal(notes[0].link, `/messages/${result.conversationId}`);
    assert.equal(notes[0].subject, "New message from Ann Learner");
    const mail = db.emails.filter((e) => e.to === teacher.email);
    assert.equal(mail.length, 1);
    assert.match(mail[0].subject, /Ann Learner sent you a message/);
    assert.ok(mail[0].html.includes("Question about week 2"));
  });

  it("refuses members the sender may not contact, and keeps nothing behind", async () => {
    const refused = await startConversation(cat, { recipientId: teacher.id, body: "hi" });
    assert.deepEqual(refused, { ok: false, error: DENY_MESSAGES.not_allowed });
    const peers = await startConversation(ann, { recipientId: bob.id, body: "hi" });
    assert.deepEqual(peers, { ok: false, error: DENY_MESSAGES.students_off });
    assert.equal((await getDb()).conversations.length, 0);
    assert.equal((await startConversation(ann, { recipientId: "usr_missing", body: "hi" })).ok, false);
    assert.equal((await startConversation(ann, { recipientId: teacher.id, body: "  " })).ok, false);
  });

  it("allows classmates when learner-to-learner messages are on", async () => {
    await seed({ studentToStudent: true });
    const result = await start(ann, bob);
    assert.equal((await getDb()).conversations.find((c) => c.id === result.conversationId)?.courseId, course.id);
  });

  it("reuses the existing conversation instead of opening a second one", async () => {
    const first = await start(ann, teacher);
    const second = await start(teacher, ann, "Sure, ask away");
    assert.equal(second.conversationId, first.conversationId);
    assert.equal(second.created, false);
    assert.equal((await getDb()).conversations.length, 1);
  });

  it("lets a learner reply to a staff member who wrote first, but blocks outsiders", async () => {
    const opened = await start(mod, cat, "Please update your profile photo.");
    const reply = await sendMessage(await user(cat.id), opened.conversationId, "Done!");
    assert.ok(reply.ok);
    const outsider = await sendMessage(await user(bob.id), opened.conversationId, "Hi");
    assert.deepEqual(outsider, { ok: false, error: "This conversation doesn't exist." });
  });

  it("stops replies when messaging is off or the other account is disabled", async () => {
    const opened = await start(ann, teacher);
    await mutate((db) => {
      db.users.find((u) => u.id === teacher.id)!.enabled = false;
    });
    assert.deepEqual(await sendMessage(ann, opened.conversationId, "Still there?"), { ok: false, error: "The other member's account is no longer active." });
    await mutate((db) => {
      db.users.find((u) => u.id === teacher.id)!.enabled = true;
      db.settings.messaging.enabled = false;
    });
    assert.deepEqual(await sendMessage(ann, opened.conversationId, "Hello?"), { ok: false, error: DENY_MESSAGES.disabled });
  });

  it("emails once per unread run and refreshes a single notification", async () => {
    const opened = await start(ann, teacher, "one");
    await sendMessage(ann, opened.conversationId, "two");
    await sendMessage(ann, opened.conversationId, "three");
    let db = await getDb();
    assert.equal(db.emails.filter((e) => e.to === teacher.email).length, 1);
    const notes = db.notifications.filter((n) => n.userId === teacher.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].message, "three");
    assert.equal(countUnreadMessages(db, teacher.id), 3);

    assert.equal(await markConversationRead(teacher.id, opened.conversationId), 3);
    db = await getDb();
    assert.equal(countUnreadMessages(db, teacher.id), 0);
    assert.ok(db.notifications.filter((n) => n.userId === teacher.id).every((n) => n.read));

    await sendMessage(ann, opened.conversationId, "four");
    db = await getDb();
    assert.equal(db.emails.filter((e) => e.to === teacher.email).length, 2, "a new unread run emails again");
  });

  it("respects the discussions email preference and the email switch", async () => {
    await mutate((db) => {
      const t = db.users.find((u) => u.id === teacher.id)!;
      t.emailPreferences = { enrollment: true, announcements: true, liveClasses: true, grading: true, certificates: true, discussions: false, reminders: true, payments: true };
    });
    await start(ann, teacher);
    const db = await getDb();
    assert.equal(db.emails.filter((e) => e.to === teacher.email).length, 0);
    assert.equal(db.notifications.filter((n) => n.userId === teacher.id).length, 1, "the in-app notification still arrives");
  });

  it("stops learner-to-learner replies once the setting is switched off or they stop sharing a course", async () => {
    await seed({ studentToStudent: true });
    const opened = await start(ann, bob, "Study group?");
    assert.ok((await sendMessage(bob, opened.conversationId, "Sure")).ok);
    await mutate((db) => {
      db.settings.messaging.studentToStudent = false;
    });
    assert.deepEqual(await sendMessage(ann, opened.conversationId, "Still on?"), { ok: false, error: REPLY_BLOCKED_MESSAGES.students_off });
    const viaStart = await startConversation(ann, { recipientId: bob.id, body: "Hello again" });
    assert.equal(viaStart.ok, false, "starting again doesn't reopen the old conversation");
    let db = await getDb();
    assert.equal(messageLinkFor(db, ann, bob.id), null);
    const thread = buildThread(db, bob, opened.conversationId);
    assert.ok(thread.ok && thread.thread.replyBlocked === REPLY_BLOCKED_MESSAGES.students_off);

    await mutate((d) => {
      d.settings.messaging.studentToStudent = true;
      d.enrollments = d.enrollments.filter((e) => e.userId !== bob.id);
    });
    assert.deepEqual(await sendMessage(ann, opened.conversationId, "Hi?"), { ok: false, error: REPLY_BLOCKED_MESSAGES.not_allowed });
    db = await getDb();
    assert.equal(db.directMessages.filter((x) => x.conversationId === opened.conversationId).length, 2, "nothing was added");
  });

  it("rate limits bursts of messages", async () => {
    const opened = await start(teacher, ann);
    let blocked: string | null = null;
    for (let i = 0; i < MESSAGE_RATES.perMinute.limit + 2 && !blocked; i++) {
      const r = await sendMessage(teacher, opened.conversationId, `msg ${i}`);
      if (!r.ok) blocked = r.error;
    }
    assert.match(blocked ?? "", /very quickly/);
  });
});

describe("inbox, threads and polling", () => {
  beforeEach(() => seed());

  it("lists conversations with unread counts, previews, search and the unread filter", async () => {
    const a = await start(ann, teacher, "From Ann");
    await start(bob, teacher, "From **Bob**");
    await markConversationRead(teacher.id, a.conversationId);
    const db = await getDb();
    const inbox = listInbox(db, teacher.id);
    assert.equal(inbox.total, 2);
    assert.equal(inbox.unreadTotal, 1);
    assert.equal(inbox.items[0].others[0].name, "Bob Learner", "newest first");
    assert.equal(inbox.items[0].preview, "From Bob");
    assert.equal(inbox.items[0].courseTitle, "Watercolor Basics");
    assert.deepEqual(
      listInbox(db, teacher.id, { filter: "unread" }).items.map((c) => c.others[0].username),
      ["bob"],
    );
    assert.deepEqual(
      listInbox(db, teacher.id, { q: "ann" }).items.map((c) => c.id),
      [a.conversationId],
    );
    const annView = listInbox(db, ann.id).items[0];
    assert.equal(annView.previewMine, true);
    assert.equal(annView.others[0].role, "Instructor");
    const paged = listInbox(db, teacher.id, { limit: 1 });
    assert.equal(paged.items.length, 1);
    assert.equal(paged.hasMore, true);
  });

  it("builds threads with read receipts and older pages", async () => {
    const opened = await start(ann, teacher, "m0");
    for (let i = 1; i < MESSAGE_LIMITS.threadPage + 5; i++) await mutate((db) => {
      db.directMessages.push({ id: `dm_x${String(i).padStart(3, "0")}`, conversationId: opened.conversationId, senderId: ann.id, body: `m${i}`, readBy: [ann.id], createdAt: new Date(Date.now() + i * 1000).toISOString() });
    });
    let db = await getDb();
    const thread = buildThread(db, ann, opened.conversationId);
    assert.ok(thread.ok);
    if (!thread.ok) return;
    assert.equal(thread.thread.messages.length, MESSAGE_LIMITS.threadPage);
    assert.equal(thread.thread.hasOlder, true);
    assert.equal(thread.thread.seenMessageId, null);
    assert.equal(thread.thread.replyBlocked, null);
    const older = buildThread(db, ann, opened.conversationId, { beforeId: thread.thread.messages[0].id });
    assert.ok(older.ok && older.thread.messages.length === 5 && !older.thread.hasOlder);

    await markConversationRead(teacher.id, opened.conversationId);
    db = await getDb();
    const after = buildThread(db, ann, opened.conversationId);
    assert.ok(after.ok);
    if (after.ok) assert.equal(after.thread.seenMessageId, after.thread.messages.at(-1)!.id);
    assert.deepEqual(buildThread(db, cat, opened.conversationId), { ok: false, status: 404 });
  });

  it("polls new messages after a cursor, marks them read and reports removals", async () => {
    const opened = await start(ann, teacher, "first");
    const firstId = opened.message.id;
    const second = await sendMessage(ann, opened.conversationId, "second");
    assert.ok(second.ok);
    const update = await pollThread(teacher, opened.conversationId, firstId, [firstId], true);
    assert.deepEqual(update?.messages.map((x) => x.body), ["second"]);
    assert.equal(countUnreadMessages(await getDb(), teacher.id), 0, "an open thread marks itself read");
    const annView = await pollThread(ann, opened.conversationId, null, [], false);
    assert.equal(annView?.seenMessageId, second.ok ? second.message.id : null);

    assert.ok((await removeMessage(ann, firstId)).ok);
    const removed = await pollThread(teacher, opened.conversationId, second.ok ? second.message.id : null, [firstId], false);
    assert.deepEqual(removed?.removedIds, [firstId]);
    assert.deepEqual(removed?.messages, []);
    assert.equal(await pollThread(cat, opened.conversationId, null, [], true), null);
  });

  it("removes only your own messages (moderators: in reported conversations)", async () => {
    const opened = await start(ann, teacher, "oops");
    assert.deepEqual(await removeMessage(teacher, opened.message.id), { ok: false, error: "You can only remove your own messages." });
    assert.equal((await removeMessage(mod, opened.message.id)).ok, false, "not reported yet");
    assert.ok((await reportConversation(teacher, opened.conversationId, "Spam links")).ok);
    const removed = await removeMessage(mod, opened.message.id);
    assert.deepEqual(removed, { ok: true, conversationId: opened.conversationId, byModerator: true });
    const row = (await getDb()).directMessages.find((x) => x.id === opened.message.id)!;
    assert.equal(row.body, "");
    assert.equal(row.removedBy, mod.id);
    assert.equal(countUnreadMessages(await getDb(), teacher.id), 0);
  });

  it("keeps the text of a removed message for moderators, so a sender can't erase reported evidence", async () => {
    const opened = await start(teacher, ann, "You are useless, quit the course");
    assert.ok((await reportConversation(ann, opened.conversationId, "Abusive message", opened.message.id)).ok);
    assert.ok((await removeMessage(teacher, opened.message.id)).ok, "the sender may still hide it from the conversation");
    const db = await getDb();
    const stored = db.directMessages.find((x) => x.id === opened.message.id)!;
    assert.equal(stored.body, "");
    assert.equal(stored.removedBody, "You are useless, quit the course");

    const modThread = buildThread(db, mod, opened.conversationId);
    assert.ok(modThread.ok);
    if (modThread.ok) {
      const shown = modThread.thread.messages.find((x) => x.id === opened.message.id)!;
      assert.equal(shown.removed, true);
      assert.equal(shown.removedByRole, "sender");
      assert.equal(shown.removedText, "You are useless, quit the course");
      assert.equal(modThread.thread.report?.messageId, opened.message.id);
    }
    for (const viewer of [ann, teacher]) {
      const t = buildThread(db, viewer, opened.conversationId);
      assert.ok(t.ok);
      if (t.ok) {
        const shown = t.thread.messages.find((x) => x.id === opened.message.id)!;
        assert.equal(shown.body, "");
        assert.equal(shown.removedText, undefined, "participants never get the removed text");
      }
    }
    const polled = await pollThread(mod, opened.conversationId, null, [], false);
    assert.equal(polled?.messages.find((x) => x.id === opened.message.id)?.removedText, "You are useless, quit the course");
    const participantPoll = await pollThread(ann, opened.conversationId, null, [], false);
    assert.equal(participantPoll?.messages.find((x) => x.id === opened.message.id)?.removedText, undefined);
  });
});

describe("recipients and message buttons", () => {
  beforeEach(() => seed());

  it("suggests the learner's instructors and searches people they may message", async () => {
    const db = await getDb();
    assert.deepEqual(
      searchRecipients(db, ann, "").map((r) => r.id),
      [teacher.id],
    );
    assert.deepEqual(searchRecipients(db, ann, "bob"), [], "classmates need the setting");
    assert.deepEqual(
      searchRecipients(db, teacher, "learner").map((r) => r.username),
      ["ann", "bob"],
    );
    assert.deepEqual(
      searchRecipients(db, teacher, "cat@example.com").map((r) => r.id),
      [cat.id],
      "staff can find members by exact email",
    );
    assert.deepEqual(searchRecipients(db, ann, "cat@example.com"), [], "learners cannot search by email");
  });

  it("resolves ?to= and builds message links only where allowed", async () => {
    let db = await getDb();
    const lookup = lookupRecipient(db, ann, "@teacher", course.id);
    assert.ok(lookup.ok);
    if (lookup.ok) assert.equal(lookup.recipient.courseTitle, "Watercolor Basics");
    const denied = lookupRecipient(db, cat, "teacher");
    assert.equal(denied.ok, false);
    assert.equal(lookupRecipient(db, ann, "nobody").ok, false);

    assert.equal(messageLinkFor(db, ann, teacher.id, course.id), `/messages/new?to=teacher&course=${course.id}`);
    assert.equal(messageLinkFor(db, cat, teacher.id), null);
    assert.equal(messageLinkFor(db, null, teacher.id), null);
    assert.equal(messageLinkFor(db, teacher, teacher.id), null);
    const opened = await start(ann, teacher);
    db = await getDb();
    assert.equal(messageLinkFor(db, ann, teacher.id), `/messages/${opened.conversationId}`);
    await mutate((d) => {
      d.settings.messaging.enabled = false;
    });
    assert.equal(messageLinkFor(await getDb(), ann, teacher.id), null);
  });
});

describe("reports and moderation", () => {
  beforeEach(() => seed());

  it("reports a conversation, notifies moderators once and lets them resolve it", async () => {
    const opened = await start(teacher, ann, "Buy my other course!!!");
    assert.equal((await reportConversation(ann, opened.conversationId, "x")).ok, false, "a reason is required");
    assert.equal((await reportConversation(cat, opened.conversationId, "Not mine")).ok, false);
    assert.ok((await reportConversation(ann, opened.conversationId, "Unwanted advertising", opened.message.id)).ok);
    assert.ok((await reportConversation(ann, opened.conversationId, "Still advertising")).ok);
    let db = await getDb();
    const modNotes = db.notifications.filter((n) => n.userId === mod.id);
    assert.equal(modNotes.length, 1, "one notification per open report");
    assert.equal(modNotes[0].link, `/messages/${opened.conversationId}`);
    const conversation = db.conversations[0];
    assert.equal(conversation.reported, true);
    assert.equal(conversation.reportCount, 2);
    assert.equal(conversation.reportReason, "Still advertising");

    const modThread = buildThread(db, mod, opened.conversationId);
    assert.ok(modThread.ok);
    if (modThread.ok) {
      assert.equal(modThread.thread.access, "moderator");
      assert.equal(modThread.thread.report?.reportedBy?.id, ann.id);
      assert.ok(modThread.thread.replyBlocked);
    }
    const annThread = buildThread(db, ann, opened.conversationId);
    assert.ok(annThread.ok && annThread.thread.reportedByViewer && annThread.thread.report?.reason === undefined, "participants don't see the reason or reporter");

    assert.equal(listReports(db, mod.id).counts.open, 1);
    assert.equal(listReports(db, mod.id, { q: "advertising" }).rows.length, 1);
    assert.equal(listReports(db, mod.id, { q: "nothing-like-this" }).rows.length, 0);
    assert.equal((await resolveReport(ann, opened.conversationId)).ok, false);
    assert.ok((await resolveReport(mod, opened.conversationId)).ok);
    db = await getDb();
    assert.deepEqual(listReports(db, mod.id).counts, { open: 0, resolved: 1 });
    assert.equal(listReports(db, mod.id, { status: "resolved" }).rows[0].resolvedBy, "Moe Moderator");
    const csv = reportCsvRows(db, mod.id);
    assert.equal(csv.length, 2);
    assert.equal(csv[1][7], "resolved");
    assert.ok(!csv.flat().some((cell) => cell.includes("Buy my other course")), "message bodies are not exported");
  });

  it("never tells the reported member that they were reported", async () => {
    const opened = await start(teacher, ann, "Rude message");
    assert.ok((await reportConversation(ann, opened.conversationId, "Harassment", opened.message.id)).ok);
    const db = await getDb();
    assert.equal(listInbox(db, ann.id).items[0].report, "open", "the reporter sees their own report");
    assert.equal(listInbox(db, teacher.id).items[0].report, null, "the other participant sees nothing");
    const reported = buildThread(db, teacher, opened.conversationId);
    assert.ok(reported.ok);
    if (reported.ok) {
      assert.equal(reported.thread.report, null);
      assert.equal(reported.thread.reportedByViewer, false);
    }
    const reporter = buildThread(db, ann, opened.conversationId);
    assert.ok(reporter.ok);
    if (reporter.ok) {
      assert.equal(reporter.thread.report?.status, "open");
      assert.equal(reporter.thread.report?.reportedBy, undefined);
      assert.equal(reporter.thread.report?.messageId, undefined);
    }
    assert.equal(db.notifications.filter((n) => n.userId === teacher.id && /reported/i.test(n.subject)).length, 0);
  });

  it("leaves a report about a moderator to the other moderators", async () => {
    await mutate((db) => {
      db.users.push(makeUser({ id: "usr_mod2", username: "mod2", name: "Mia Moderator", email: "mod2@example.com", roles: ["moderator"] }));
    });
    const opened = await start(mod, cat, "Your profile breaks the rules.");
    assert.ok((await reportConversation(cat, opened.conversationId, "The moderator is threatening me")).ok);
    let db = await getDb();
    assert.equal(db.notifications.filter((n) => n.userId === mod.id && n.subject === "A conversation was reported").length, 0, "the accused moderator isn't notified");
    assert.equal(db.notifications.filter((n) => n.userId === "usr_mod2" && n.subject === "A conversation was reported").length, 1);
    assert.equal(listReports(db, mod.id).counts.open, 0, "hidden from the accused moderator");
    assert.equal(reportCsvRows(db, mod.id).length, 1, "only the header");
    assert.equal(listReports(db, "usr_mod2").counts.open, 1);
    const ownView = buildThread(db, mod, opened.conversationId);
    assert.ok(ownView.ok && ownView.thread.access === "participant" && ownView.thread.report === null);

    const own = await resolveReport(mod, opened.conversationId);
    assert.equal(own.ok, false);
    db = await getDb();
    assert.equal(db.conversations.find((c) => c.id === opened.conversationId)?.reported, true, "still open");
    assert.ok((await resolveReport(db.users.find((u) => u.id === "usr_mod2")!, opened.conversationId)).ok);
  });
});

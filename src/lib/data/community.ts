import "server-only";
import type { Batch, Course, Database, DiscussionReply, DiscussionTopic, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { getLearnContext, lessonHasQuiz } from "@/lib/data/lessons";
import { canManageBatch } from "@/lib/data/batches";
import { getDiscussionPointsSince, startOfMonth } from "@/lib/services/points";
import { stripMarkdown, truncate } from "@/lib/utils";

/**
 * Community hub (/community): every discussion topic the viewer can take
 * part in, in one place.
 *
 * Access mirrors the thread locations exactly:
 *  - lesson topics of courses the viewer is enrolled in or manages, on
 *    lessons the viewer can open (locked lessons stay hidden) and that do not
 *    contain a quiz (those lessons keep discussions closed);
 *  - batch topics of batches the viewer is enrolled in or manages.
 * Links go to the thread itself: the lesson's Discussion tab
 * (`?tab=discussion&topic=<id>`) or the batch's Discussions tab.
 */

export type CommunityTab = "latest" | "unanswered" | "mine";
export const COMMUNITY_TABS: CommunityTab[] = ["latest", "unanswered", "mine"];

export function parseCommunityTab(value: unknown): CommunityTab {
  return value === "unanswered" || value === "mine" ? value : "latest";
}

export const COMMUNITY_PAGE_SIZE = 15;

export interface CommunityMember {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
}

export interface CommunitySpaceRef {
  kind: "course" | "batch";
  id: string;
  title: string;
  href: string;
}

export interface CommunityTopic {
  id: string;
  title: string;
  kind: "lesson" | "batch";
  /** Link to the thread in place. */
  href: string;
  where: CommunitySpaceRef;
  lessonTitle: string | null;
  author: CommunityMember | null;
  authorIsInstructor: boolean;
  /** Plain-text preview of the opening post. */
  excerpt: string;
  createdAt: string;
  lastActivityAt: string;
  lastReplyBy: CommunityMember | null;
  /** Replies after the opening post. */
  replyCount: number;
  participants: CommunityMember[];
  /** Someone other than the author replied. */
  answered: boolean;
  /** An instructor of the course/batch replied (and is not the author). */
  instructorAnswered: boolean;
  isAuthor: boolean;
  /** The viewer asked or replied. */
  participated: boolean;
}

export interface CommunityScope {
  /** "course:<id>" or "batch:<id>" */
  value: string;
  label: string;
  kind: "course" | "batch";
  topicCount: number;
}

export interface CommunityContributor {
  member: CommunityMember;
  replies: number;
  /** Replies on other members' questions. */
  answers: number;
  isInstructor: boolean;
  /** Discussion points earned this month (0 when points are off). */
  points: number;
}

export interface CommunityViewerStats {
  asked: number;
  replies: number;
  /** The viewer's questions nobody else has replied to yet. */
  waiting: number;
  /** The viewer's questions answered by an instructor. */
  instructorAnswered: number;
}

export interface CommunityHub {
  tab: CommunityTab;
  scope: string | null;
  query: string;
  page: number;
  pageCount: number;
  pageSize: number;
  /** Topics matching tab + scope + search. */
  total: number;
  topics: CommunityTopic[];
  /** Per-tab counts with the current scope and search applied. */
  counts: Record<CommunityTab, number>;
  scopes: { courses: CommunityScope[]; batches: CommunityScope[] };
  /** Courses and batches whose discussions the viewer can join. */
  spaces: { courses: number; batches: number };
  /** Every topic the viewer can see, before filters. */
  totalVisible: number;
  contributors: CommunityContributor[];
  stats: CommunityViewerStats;
  pointsEnabled: boolean;
  monthLabel: string;
}

interface VisibleTopic {
  topic: DiscussionTopic;
  kind: "lesson" | "batch";
  href: string;
  where: CommunitySpaceRef;
  lessonTitle: string | null;
  instructors: Set<string>;
  /** Replies oldest first; the first one is the opening post. */
  replies: DiscussionReply[];
}

function toMember(user: User | undefined): CommunityMember | null {
  return user ? { id: user.id, name: user.name, username: user.username, avatarUrl: user.avatarUrl } : null;
}

/** Resolve every topic the viewer may read, with its thread link and space. */
async function collectVisibleTopics(db: Database, viewer: User): Promise<{ topics: VisibleTopic[]; spaces: { courses: number; batches: number } }> {
  const enrolledCourses = new Set(db.enrollments.filter((e) => e.userId === viewer.id).map((e) => e.courseId));
  const enrolledBatches = new Set(db.batchEnrollments.filter((e) => e.userId === viewer.id).map((e) => e.batchId));

  const courseSpaces = new Map<string, Course>();
  for (const course of db.courses) {
    if (enrolledCourses.has(course.id) || canManageCourse(viewer, course)) courseSpaces.set(course.id, course);
  }
  const batchSpaces = new Map<string, Batch>();
  for (const batch of db.batches) {
    if (enrolledBatches.has(batch.id) || canManageBatch(viewer, batch)) batchSpaces.set(batch.id, batch);
  }

  const lessons = new Map(db.lessons.map((l) => [l.id, l]));
  const repliesByTopic = new Map<string, DiscussionReply[]>();
  for (const r of db.discussionReplies) {
    const list = repliesByTopic.get(r.topicId) ?? [];
    list.push(r);
    repliesByTopic.set(r.topicId, list);
  }

  // Lesson links and locks come from the learn context, so drip/sequential locks match the player.
  const coursesWithTopics = new Set<string>();
  for (const t of db.discussionTopics) {
    if (t.refType !== "lesson") continue;
    const lesson = lessons.get(t.refId);
    if (lesson && courseSpaces.has(lesson.courseId)) coursesWithTopics.add(lesson.courseId);
  }
  const openLessons = new Map<string, { href: string; title: string; course: Course }>();
  for (const courseId of coursesWithTopics) {
    const course = courseSpaces.get(courseId)!;
    try {
      const ctx = await getLearnContext(course, viewer);
      for (const l of ctx.flat) if (!l.locked) openLessons.set(l.id, { href: l.href, title: l.title, course });
    } catch (err) {
      // Fail closed: without a context we cannot tell which lessons are open.
      console.error("[community] could not resolve lessons for a course:", err instanceof Error ? err.message : err);
    }
  }

  const topics: VisibleTopic[] = [];
  for (const topic of db.discussionTopics) {
    const replies = (repliesByTopic.get(topic.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (topic.refType === "lesson") {
      const open = openLessons.get(topic.refId);
      const lesson = lessons.get(topic.refId);
      if (!open || !lesson || lessonHasQuiz(lesson)) continue;
      topics.push({
        topic,
        kind: "lesson",
        href: `${open.href}?tab=discussion&topic=${encodeURIComponent(topic.id)}`,
        where: { kind: "course", id: open.course.id, title: open.course.title, href: `/courses/${open.course.slug}` },
        lessonTitle: open.title,
        instructors: new Set(open.course.instructorIds),
        replies,
      });
    } else if (topic.refType === "batch") {
      const batch = batchSpaces.get(topic.refId);
      if (!batch) continue;
      topics.push({
        topic,
        kind: "batch",
        href: `/batches/${batch.slug}?tab=discussions#topic-${topic.id}`,
        where: { kind: "batch", id: batch.id, title: batch.title, href: `/batches/${batch.slug}?tab=discussions` },
        lessonTitle: null,
        instructors: new Set(batch.instructorIds),
        replies,
      });
    }
  }
  return { topics, spaces: { courses: courseSpaces.size, batches: batchSpaces.size } };
}

function buildTopic(v: VisibleTopic, viewer: User, users: Map<string, User>): CommunityTopic {
  const { topic, replies, instructors } = v;
  const opening = replies[0];
  const rest = replies.slice(1);
  const last = rest.at(-1) ?? null;
  const lastActivityAt = last && last.createdAt > topic.createdAt ? last.createdAt : topic.createdAt;
  const participantIds: string[] = [];
  for (const id of [topic.authorId, ...rest.map((r) => r.authorId)]) if (!participantIds.includes(id)) participantIds.push(id);
  return {
    id: topic.id,
    title: topic.title,
    kind: v.kind,
    href: v.href,
    where: v.where,
    lessonTitle: v.lessonTitle,
    author: toMember(users.get(topic.authorId)),
    authorIsInstructor: instructors.has(topic.authorId),
    excerpt: opening ? truncate(stripMarkdown(opening.content).replace(/\s+/g, " "), 180) : "",
    createdAt: topic.createdAt,
    lastActivityAt,
    lastReplyBy: last ? toMember(users.get(last.authorId)) : null,
    replyCount: rest.length,
    participants: participantIds
      .slice(0, 5)
      .map((id) => toMember(users.get(id)))
      .filter((m): m is CommunityMember => !!m),
    answered: rest.some((r) => r.authorId !== topic.authorId),
    instructorAnswered: rest.some((r) => r.authorId !== topic.authorId && instructors.has(r.authorId)),
    isAuthor: topic.authorId === viewer.id,
    participated: topic.authorId === viewer.id || rest.some((r) => r.authorId === viewer.id),
  };
}

function matchesSearch(v: VisibleTopic, t: CommunityTopic, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = [t.title, t.where.title, t.lessonTitle ?? "", t.author?.name ?? "", ...v.replies.map((r) => r.content)].join("\n").toLowerCase();
  return terms.every((term) => hay.includes(term));
}

/** The community hub for a viewer: filtered topics, per-tab counts, spaces, contributors and personal stats. */
export async function getCommunityHub(
  viewer: User,
  input: { tab?: CommunityTab; scope?: string | null; query?: string; page?: number } = {},
): Promise<CommunityHub> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const { topics: visible, spaces } = await collectVisibleTopics(db, viewer);
  const built = visible.map((v) => ({ v, t: buildTopic(v, viewer, users) }));

  // Spaces with at least one visible topic, for the filter.
  const scopeMap = new Map<string, CommunityScope>();
  for (const { t } of built) {
    const value = `${t.where.kind}:${t.where.id}`;
    const entry = scopeMap.get(value) ?? { value, label: t.where.title, kind: t.where.kind, topicCount: 0 };
    entry.topicCount++;
    scopeMap.set(value, entry);
  }
  const scopes = Array.from(scopeMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  const scope = input.scope && scopeMap.has(input.scope) ? input.scope : null;

  const query = (input.query ?? "").trim().slice(0, 100);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = built.filter(({ v, t }) => (!scope || `${t.where.kind}:${t.where.id}` === scope) && matchesSearch(v, t, terms));

  const counts: Record<CommunityTab, number> = {
    latest: filtered.length,
    unanswered: filtered.filter(({ t }) => !t.answered).length,
    mine: filtered.filter(({ t }) => t.participated).length,
  };
  const tab = input.tab ?? "latest";
  const tabbed = filtered
    .filter(({ t }) => (tab === "unanswered" ? !t.answered : tab === "mine" ? t.participated : true))
    .map(({ t }) => t)
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  const pageCount = Math.max(1, Math.ceil(tabbed.length / COMMUNITY_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Math.floor(input.page ?? 1) || 1));

  // Top contributors this month across the viewer's spaces.
  const monthStart = startOfMonth();
  const monthIso = monthStart.toISOString();
  const pointsEnabled = db.settings.gamification.enabled;
  const discussionPoints = pointsEnabled ? await getDiscussionPointsSince(monthStart) : new Map<string, number>();
  const tally = new Map<string, CommunityContributor>();
  for (const v of visible) {
    for (const r of v.replies.slice(1)) {
      if (r.createdAt < monthIso) continue;
      const user = users.get(r.authorId);
      if (!user || !user.enabled) continue;
      const row = tally.get(user.id) ?? { member: toMember(user)!, replies: 0, answers: 0, isInstructor: false, points: discussionPoints.get(user.id) ?? 0 };
      row.replies++;
      if (r.authorId !== v.topic.authorId) row.answers++;
      if (v.instructors.has(r.authorId)) row.isInstructor = true;
      tally.set(user.id, row);
    }
  }
  const contributors = Array.from(tally.values())
    .sort((a, b) => b.answers - a.answers || b.replies - a.replies || a.member.name.localeCompare(b.member.name))
    .slice(0, 5);

  // Personal stats over everything the viewer can see.
  const stats: CommunityViewerStats = { asked: 0, replies: 0, waiting: 0, instructorAnswered: 0 };
  for (const { v, t } of built) {
    if (t.isAuthor) {
      stats.asked++;
      if (!t.answered) stats.waiting++;
      if (t.instructorAnswered) stats.instructorAnswered++;
    }
    for (const r of v.replies.slice(1)) if (r.authorId === viewer.id) stats.replies++;
  }

  return {
    tab,
    scope,
    query,
    page,
    pageCount,
    pageSize: COMMUNITY_PAGE_SIZE,
    total: tabbed.length,
    topics: tabbed.slice((page - 1) * COMMUNITY_PAGE_SIZE, page * COMMUNITY_PAGE_SIZE),
    counts,
    scopes: { courses: scopes.filter((s) => s.kind === "course"), batches: scopes.filter((s) => s.kind === "batch") },
    spaces,
    totalVisible: built.length,
    contributors,
    stats,
    pointsEnabled,
    monthLabel: monthStart.toLocaleDateString("en-US", { month: "long" }),
  };
}

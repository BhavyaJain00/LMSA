import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@/lib/types";
import { getCurrentUser, hasRole, isModerator, isStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { canManageCourse } from "@/lib/data/courses";
import { fuzzyMatch } from "@/components/command-palette/fuzzy";
import type { SearchResultGroup, SearchResultItem, SearchScope } from "@/components/command-palette/config";
import { formatDate, truncate } from "@/lib/utils";

const SCOPES: SearchScope[] = ["courses", "batches", "programs", "jobs", "quizzes", "assignments", "people"];

interface Candidate {
  id: string;
  title: string;
  /** Extra text searched with a lower weight (tags, company, headline…). */
  extra?: string;
  subtitle?: string;
  href: string;
  updatedAt?: string;
}

function rank(query: string, candidates: Candidate[], limit: number): SearchResultItem[] {
  const scored: (SearchResultItem & { score: number })[] = [];
  for (const c of candidates) {
    const titleMatch = fuzzyMatch(query, c.title);
    let score = titleMatch?.score ?? -1;
    if (!titleMatch && c.extra) {
      const extraMatch = fuzzyMatch(query, c.extra);
      if (extraMatch && extraMatch.score >= 600) score = extraMatch.score * 0.4;
    }
    if (score < 0) continue;
    scored.push({ id: c.id, title: c.title, subtitle: c.subtitle, href: c.href, updatedAt: c.updatedAt, indices: titleMatch?.indices ?? [], score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => {
      void _score;
      return rest;
    });
}

function canSeeAssessments(viewer: User | null): boolean {
  return hasRole(viewer, "moderator", "course_creator");
}

/**
 * GET /api/search?q=<query>&scope=<courses|batches|programs|jobs|quizzes|assignments|people>
 * Grouped, permission-aware search used by the command palette.
 */
export async function GET(req: NextRequest) {
  const viewer = await getCurrentUser();
  const params = req.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  const scopeParam = params.get("scope");
  const scope = SCOPES.includes(scopeParam as SearchScope) ? (scopeParam as SearchScope) : null;
  const headers = { "Cache-Control": "no-store" };

  if (query.length < 2) return NextResponse.json({ ok: true, query, groups: [] as SearchResultGroup[] }, { headers });

  const db = await getDb();
  const f = db.settings.features;
  const moderator = isModerator(viewer);
  const limit = scope ? 20 : 5;
  const want = (s: SearchScope) => !scope || scope === s;
  const groups: SearchResultGroup[] = [];
  const categories = new Map(db.categories.map((c) => [c.id, c.name]));

  if (want("courses") && f.courses) {
    const items = rank(
      query,
      db.courses
        .filter((c) => c.published || canManageCourse(viewer, c))
        .map((c) => ({
          id: c.id,
          title: c.title,
          extra: `${c.tags.join(" ")} ${c.shortIntroduction}`,
          subtitle: [c.categoryId ? categories.get(c.categoryId) : undefined, !c.published ? "Unpublished" : c.upcoming ? "Upcoming" : undefined]
            .filter(Boolean)
            .join(" · ") || truncate(c.shortIntroduction, 70),
          href: `/courses/${c.slug}`,
          updatedAt: c.updatedAt,
        })),
      limit,
    );
    if (items.length) groups.push({ key: "courses", label: "Courses", items });
  }

  if (want("batches") && f.batches) {
    const items = rank(
      query,
      db.batches
        .filter((b) => b.published || moderator || hasRole(viewer, "batch_evaluator") || (!!viewer && (b.instructorIds.includes(viewer.id) || b.createdById === viewer.id)))
        .map((b) => ({
          id: b.id,
          title: b.title,
          extra: b.description,
          subtitle: `${formatDate(b.startDate, { year: undefined })} – ${formatDate(b.endDate)}${b.published ? "" : " · Unpublished"}`,
          href: `/batches/${b.slug}`,
          updatedAt: b.updatedAt,
        })),
      limit,
    );
    if (items.length) groups.push({ key: "batches", label: "Batches", items });
  }

  if (want("programs") && f.programs) {
    const items = rank(
      query,
      db.programs
        .filter((p) => p.published || moderator || (!!viewer && p.createdById === viewer.id))
        .map((p) => ({
          id: p.id,
          title: p.title,
          extra: p.description,
          subtitle: `${p.courseIds.length} ${p.courseIds.length === 1 ? "course" : "courses"}${p.published ? "" : " · Unpublished"}`,
          href: p.published ? `/programs/${p.slug}` : `/admin/programs/${p.id}`,
          updatedAt: p.updatedAt,
        })),
      limit,
    );
    if (items.length) groups.push({ key: "programs", label: "Programs", items });
  }

  if (want("jobs") && f.jobs) {
    const items = rank(
      query,
      db.jobs
        .filter((j) => j.status === "open" || moderator || (!!viewer && j.postedById === viewer.id))
        .map((j) => ({
          id: j.id,
          title: j.title,
          extra: `${j.company} ${j.location}`,
          subtitle: `${j.company} · ${j.remote ? "Remote" : j.location}${j.status === "closed" ? " · Closed" : ""}`,
          href: `/jobs/${j.slug}`,
          updatedAt: j.updatedAt,
        })),
      limit,
    );
    if (items.length) groups.push({ key: "jobs", label: "Job Opportunities", items });
  }

  if (canSeeAssessments(viewer)) {
    const manageable = (courseId: string | undefined, authorId: string) => {
      if (moderator) return true;
      if (viewer && authorId === viewer.id) return true;
      const course = courseId ? db.courses.find((c) => c.id === courseId) : undefined;
      return !!course && canManageCourse(viewer, course);
    };
    const courseTitle = (courseId: string | undefined) => (courseId ? db.courses.find((c) => c.id === courseId)?.title : undefined);

    if (want("quizzes")) {
      const items = rank(
        query,
        db.quizzes
          .filter((q) => manageable(q.courseId, q.authorId))
          .map((q) => ({
            id: q.id,
            title: q.title,
            subtitle: [courseTitle(q.courseId), `${q.questions.length} ${q.questions.length === 1 ? "question" : "questions"}`].filter(Boolean).join(" · "),
            href: `/admin/quizzes/${q.id}`,
            updatedAt: q.updatedAt,
          })),
        limit,
      );
      if (items.length) groups.push({ key: "quizzes", label: "Quizzes", items });
    }

    if (want("assignments")) {
      const items = rank(
        query,
        db.assignments
          .filter((a) => manageable(a.courseId, a.authorId))
          .map((a) => ({
            id: a.id,
            title: a.title,
            subtitle: courseTitle(a.courseId) ?? "Assignment",
            href: `/admin/assignments/${a.id}`,
            updatedAt: a.updatedAt,
          })),
        limit,
      );
      if (items.length) groups.push({ key: "assignments", label: "Assignments", items });
    }
  }

  if (want("people") && viewer) {
    const items = rank(
      query,
      db.users
        .filter((u) => u.enabled || moderator)
        .map((u) => ({
          id: u.id,
          title: u.name,
          extra: `${u.username} ${u.headline ?? ""} ${isStaff(viewer) ? u.email : ""}`,
          subtitle: u.headline ? truncate(u.headline, 70) : `@${u.username}`,
          href: `/user/${u.username}`,
          updatedAt: u.lastActiveAt,
        })),
      limit,
    );
    if (items.length) groups.push({ key: "people", label: "People", items });
  }

  return NextResponse.json({ ok: true, query, groups }, { headers });
}

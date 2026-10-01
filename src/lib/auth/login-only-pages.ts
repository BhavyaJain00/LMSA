/**
 * Login-only PAGES, matched exactly by the proxy so guests get a real
 * `307 → /login?next=…` instead of a streamed 200 whose body redirects.
 *
 * Every entry is the URL pattern of a `page.tsx` whose render always calls
 * `requireUser`, `requireRole` or `requireManageableCourse` (directly or
 * through a guarding layout). Patterns are exact: `[param]` matches one
 * path segment and nothing matches deeper paths, so route handlers next to
 * or below these pages (CSV exports, `/quiz/[id]/submit`, feeds) are never
 * caught; they check the session themselves. Pages that also serve guests
 * (`/you`, `/team/buy`, catalog pages, the lesson player) or only require a
 * login when a setting says so (`/leaderboard`, `/statistics`) are not here.
 *
 * `tests/proxy-login-only.test.ts` checks this list against `src/app`, so a
 * new guarded page must be added here. Pure and edge-safe (no imports
 * beyond the redirect helper).
 */
import { safeRedirectPath } from "@/lib/auth/redirects";

export const LOGIN_ONLY_PAGES: readonly string[] = [
  "/admin", "/admin/affiliates", "/admin/affiliates/[id]", "/admin/ai", "/admin/ai/conversations/[id]", "/admin/ai/usage", "/admin/analytics",
  "/admin/assignments", "/admin/assignments/[id]", "/admin/assignments/new", "/admin/assignments/submissions", "/admin/assignments/submissions/[id]",
  "/admin/audit", "/admin/batches", "/admin/batches/[id]", "/admin/batches/new", "/admin/blog", "/admin/blog/[id]", "/admin/blog/new",
  "/admin/broadcasts", "/admin/broadcasts/[id]", "/admin/broadcasts/[id]/edit", "/admin/broadcasts/audience", "/admin/broadcasts/new",
  "/admin/broadcasts/tracking", "/admin/certificates", "/admin/certificates/bulk", "/admin/certificates/new", "/admin/courses",
  "/admin/courses/[id]", "/admin/courses/[id]/dashboard", "/admin/courses/[id]/lessons/[lessonId]",
  "/admin/courses/[id]/lessons/[lessonId]/transcript", "/admin/courses/[id]/sales-page", "/admin/courses/[id]/video-analytics",
  "/admin/courses/import", "/admin/courses/new", "/admin/emails", "/admin/emails/[id]", "/admin/emails/compose", "/admin/errors",
  "/admin/errors/[id]", "/admin/exercises", "/admin/exercises/[id]", "/admin/exercises/new", "/admin/exercises/submissions",
  "/admin/exercises/submissions/[id]", "/admin/jobs", "/admin/jobs/[id]", "/admin/jobs/[id]/applications", "/admin/jobs/new", "/admin/leads",
  "/admin/marketplace", "/admin/marketplace/[id]", "/admin/members", "/admin/members/[id]", "/admin/members/import", "/admin/members/new",
  "/admin/programs", "/admin/programs/[id]", "/admin/programs/new", "/admin/questions", "/admin/questions/[id]", "/admin/questions/new",
  "/admin/quizzes", "/admin/quizzes/[id]", "/admin/quizzes/new", "/admin/quizzes/submissions", "/admin/quizzes/submissions/[id]", "/admin/rubrics",
  "/admin/rubrics/[id]", "/admin/rubrics/new", "/admin/security", "/admin/sequences", "/admin/sequences/[id]", "/admin/sequences/[id]/edit",
  "/admin/sequences/new", "/admin/settings", "/admin/settings/ai", "/admin/settings/api", "/admin/settings/api/webhooks/[id]",
  "/admin/settings/badges", "/admin/settings/branding", "/admin/settings/categories", "/admin/settings/coupons", "/admin/settings/data",
  "/admin/settings/email", "/admin/settings/features", "/admin/settings/gamification", "/admin/settings/general", "/admin/settings/learning",
  "/admin/settings/legal", "/admin/settings/legal/[slug]", "/admin/settings/payments", "/admin/settings/plans", "/admin/settings/pwa",
  "/admin/settings/security", "/admin/settings/seo", "/admin/settings/seo/indexing", "/admin/settings/seo/redirects", "/admin/settings/seo/tracking",
  "/admin/settings/sidebar", "/admin/settings/storage", "/admin/settings/taxes", "/admin/settings/transactions", "/admin/settings/video",
  "/admin/teams", "/admin/teams/[id]", "/admin/upsells",
  "/affiliate",
  "/assignments/[id]",
  "/billing/[type]/[id]", "/billing/cancelled", "/billing/history", "/billing/invoice/[orderId]", "/billing/success/[orderId]",
  "/community",
  "/courses/[slug]/ask", "/courses/[slug]/certification",
  "/dashboard",
  "/exercises/[id]", "/exercises/submissions", "/exercises/submissions/[id]",
  "/gift",
  "/jobs/[slug]/applications", "/jobs/[slug]/edit", "/jobs/applications", "/jobs/mine", "/jobs/new",
  "/leaderboard/points",
  "/messages", "/messages/[conversationId]", "/messages/moderation", "/messages/new",
  "/notifications",
  "/peer-reviews", "/peer-reviews/[id]", "/peer-reviews/manage", "/peer-reviews/manage/[assignmentId]",
  "/persona",
  "/quiz/[id]", "/quiz/submissions/[id]",
  "/settings", "/settings/calendar", "/settings/notifications", "/settings/privacy", "/settings/security", "/settings/subscription",
  "/teach", "/teach/earnings",
  "/team",
  "/user/[username]/badges", "/user/[username]/certificates", "/user/[username]/edit", "/user/[username]/roles", "/user/[username]/schedule",
  "/user/[username]/slots",
];

/**
 * Static route handlers that sit where a `[param]` page pattern above would
 * also match (Next serves the static segment first). They are never login
 * redirects: they answer with their own status codes.
 */
export const STATIC_ROUTE_HANDLERS: readonly string[] = [
  "/admin/affiliates/export",
  "/admin/blog/export",
  "/admin/broadcasts/export",
  "/admin/marketplace/export",
  "/admin/quizzes/submissions/export",
  "/admin/teams/export",
  "/messages/feed",
];

const HANDLERS = new Set(STATIC_ROUTE_HANDLERS);

type Matcher = { static: Map<string, true>; dynamic: { segments: (string | null)[] }[] };

function compile(patterns: readonly string[]): Matcher {
  const matcher: Matcher = { static: new Map(), dynamic: [] };
  for (const pattern of patterns) {
    if (!pattern.includes("[")) {
      matcher.static.set(pattern, true);
      continue;
    }
    // `null` stands for a `[param]` segment (exactly one non-empty segment).
    matcher.dynamic.push({ segments: pattern.split("/").slice(1).map((s) => (s.startsWith("[") && s.endsWith("]") ? null : s)) });
  }
  return matcher;
}

const MATCHER = compile(LOGIN_ONLY_PAGES);

/** Whether `pathname` (as the proxy sees it, without query) is a login-only page. */
export function isLoginOnlyPage(pathname: string): boolean {
  if (!pathname.startsWith("/")) return false;
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (MATCHER.static.has(path)) return true;
  if (HANDLERS.has(path)) return false;
  const parts = path.split("/").slice(1);
  return MATCHER.dynamic.some(({ segments }) => segments.length === parts.length && segments.every((s, i) => (s === null ? parts[i]!.length > 0 : s === parts[i])));
}

/**
 * The login URL (path and query) a guest is sent to from a login-only page:
 * `/login?next=<page>` when the page is a safe same-origin return path,
 * else plain `/login`.
 */
export function guestLoginPath(pathname: string, search: string): string {
  const next = safeRedirectPath(`${pathname}${search}`);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

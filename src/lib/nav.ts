import type { IconName } from "@/components/ui/icons";
import type { Database, Organization, PublicUser, Settings } from "@/lib/types";
import englishShell from "@/i18n/messages/en/shell";
import { isBundleOnSale } from "@/lib/commerce/bundles";
import { isJobPublic, isPostPublic, isProgramPublic } from "@/lib/seo/visibility";

/** Shell message keys (`src/i18n/messages/en/shell.ts`). */
export type ShellKey = keyof typeof englishShell;
/** Resolves a shell label: the server passes `await getT("shell")`; tests and defaults use English. */
export type ShellLabel = (key: ShellKey) => string;
export const englishShellLabel: ShellLabel = (key) => englishShell[key];

/**
 * Where an item sits in the sidebar (see `buildSidebarNav`): learner items are `primary` (always visible) or
 * `more` (a collapsible group); `account` items live in the avatar menu instead of the sidebar; staff items
 * are grouped under the "Teaching & admin" workspace.
 */
export type NavGroup = "primary" | "more" | "account" | "overview" | "content" | "people" | "business" | "settings";

export interface NavItem {
  label: string;
  /** Shorter label for the grouped admin sidebar ("Courses" under Content instead of "Manage courses"). */
  shortLabel?: string;
  href: string;
  icon: IconName;
  /** Match nested routes too. */
  prefix?: boolean;
  badge?: number;
  group?: NavGroup;
}

export interface NavSection {
  /** Stable id of the section (titles are translated, so compare keys, not titles). */
  key: "main" | "you" | "manage" | "links";
  title?: string;
  items: NavItem[];
}

/** Staff grading queue (submissions waiting for a grade). */
export const GRADING_HREF = "/admin/assignments/submissions?status=not_graded";

function has(user: PublicUser | null, ...roles: string[]): boolean {
  if (!user) return false;
  if (user.roles.includes("admin")) return true;
  return roles.some((r) => user.roles.includes(r as PublicUser["roles"][number]));
}

/** Per-viewer facts the navigation needs besides the user and settings. */
export interface NavContext {
  /** Unread notifications. */
  unread?: number;
  /** Assignment submissions waiting to be graded (staff). */
  grading?: number;
  /** Round 3 wave B: unread direct messages. */
  messages?: number;
  /** Round 3 wave B: the viewer owns or manages an organization (shows "My team"). */
  managesOrg?: boolean;
  /** Round 3 wave B: the viewer has an instructor profile (keeps "Teach" after applications close). */
  instructor?: boolean;
  /** Round 3 wave B: the viewer has peer reviews assigned (shows "Peer reviews"). */
  peerReviews?: boolean;
  /**
   * How much public content exists. A known zero hides the matching public page from the navigation
   * (no "Membership" without plans, no "Blog" without posts); unknown counts keep the item.
   */
  content?: NavContentCounts;
}

/** Public content behind the optional storefront pages (see `navContentCounts`). */
export interface NavContentCounts {
  /** Active membership plans (/pricing). */
  plans?: number;
  /** Public blog posts (/blog). */
  posts?: number;
  /** Bundles on sale (/bundles). */
  bundles?: number;
  /** Open job openings (/jobs). */
  jobs?: number;
  /** Published programs (/programs). */
  programs?: number;
}

/** Counts the public content that decides whether storefront pages appear in the navigation. */
export function navContentCounts(
  db: Pick<Database, "plans" | "blogPosts" | "bundles" | "courses" | "jobs" | "programs">,
  now: number = Date.now(),
): Required<NavContentCounts> {
  return {
    plans: db.plans.filter((p) => p.active).length,
    posts: db.blogPosts.filter((p) => isPostPublic(p, now)).length,
    bundles: db.bundles.filter((b) => isBundleOnSale(b, db.courses)).length,
    jobs: db.jobs.filter(isJobPublic).length,
    programs: db.programs.filter(isProgramPublic).length,
  };
}

/** False only when the count is known to be zero. */
function hasContent(count: number | undefined): boolean {
  return count === undefined || count > 0;
}

/** The per-viewer navigation facts that come from the database (everything except the notification count). */
export function navContextFor(db: Pick<Database, "organizations" | "instructorProfiles" | "peerReviews">, userId: string): Pick<NavContext, "managesOrg" | "instructor" | "peerReviews"> {
  return {
    managesOrg: managesOrganization(db.organizations, userId),
    instructor: db.instructorProfiles.some((p) => p.userId === userId && p.status !== "rejected"),
    peerReviews: db.peerReviews.some((r) => r.reviewerId === userId),
  };
}

/** Whether a user owns or manages any of the given organizations (round 3 wave B teams). */
export function managesOrganization(organizations: readonly Pick<Organization, "ownerId" | "managerIds">[], userId: string | null | undefined): boolean {
  if (!userId) return false;
  return organizations.some((o) => o.ownerId === userId || o.managerIds.includes(userId));
}

/**
 * Build the full navigation for a viewer (mirrors Frappe LMS's role-aware sidebar), labelled in the viewer's
 * language. Every destination the viewer may use is listed once; `group` says where the sidebar shows it
 * (`buildSidebarNav`), the guest top bar picks its links with `buildGuestNav`, and the command palette and
 * the /you hub list everything.
 */
export function buildNavigation(user: PublicUser | null, settings: Settings, counts: NavContext = {}, l: ShellLabel = englishShellLabel): NavSection[] {
  const f = settings.features;
  const c = counts.content ?? {};
  const main: NavItem[] = [];
  if (user) main.push({ label: l("nav.dashboard"), href: "/dashboard", icon: "Home", group: "primary" });
  if (f.courses) main.push({ label: l("nav.courses"), href: "/courses", icon: "BookOpen", prefix: true, group: "primary" });
  if (f.batches) main.push({ label: l("nav.batches"), href: "/batches", icon: "Users", prefix: true, group: "primary" });
  if (f.programs && hasContent(c.programs)) main.push({ label: l("nav.programs"), href: "/programs", icon: "Layers", prefix: true, group: "more" });
  // Round 3 wave B: course bundles and membership plans are public sales pages (hidden while there is nothing to buy).
  const g = settings.growth;
  if (g.bundlesEnabled && f.courses && hasContent(c.bundles)) main.push({ label: l("nav.bundles"), href: "/bundles", icon: "Gift", prefix: true, group: "more" });
  if (g.subscriptionsEnabled && hasContent(c.plans)) main.push({ label: l("nav.membership"), href: "/pricing", icon: "Star", group: "more" });
  if (user && f.certifications && f.certifiedMembers) main.push({ label: l("nav.certifiedMembers"), href: "/certified-members", icon: "Award", group: "more" });
  if (f.jobs && hasContent(c.jobs)) main.push({ label: l("nav.jobs"), href: "/jobs", icon: "Briefcase", prefix: true, group: "more" });
  // Round 3: public instructor directory (guests only when they may browse the catalog).
  if (f.courses && (user || settings.learning.allowGuestAccess)) main.push({ label: l("nav.instructors"), href: "/instructors", icon: "Presentation", prefix: true, group: "more" });
  // Round 3: public blog (articles are always readable by guests; the switch lives in SEO settings).
  if (settings.seo.blogEnabled && hasContent(c.posts)) main.push({ label: l("nav.blog"), href: "/blog", icon: "FileText", prefix: true, group: "more" });
  // Statistics, the community hub and the leaderboard are member pages: guests can still open them by URL
  // (when guest access allows), but the storefront navigation does not advertise them. Drill-downs stay
  // staff-only on the page; points history lives under /leaderboard/points (linked from the profile).
  if (user && f.statistics) main.push({ label: l("nav.statistics"), href: "/statistics", icon: "BarChart", group: "more" });
  if (user && f.discussions && (f.courses || f.batches)) main.push({ label: l("nav.community"), href: "/community", icon: "MessageSquare", prefix: true, group: "more" });
  if (user && settings.gamification.enabled && settings.gamification.showLeaderboard)
    main.push({ label: l("nav.leaderboard"), href: "/leaderboard", icon: "Trophy", prefix: true, group: "more" });

  const sections: NavSection[] = [{ key: "main", items: main }];

  if (user) {
    const learn: NavItem[] = [];
    if (f.notifications) learn.push({ label: l("nav.notifications"), href: "/notifications", icon: "Bell", badge: counts.unread, group: "primary" });
    // Round 3 wave B: direct messages, team management, affiliate programme and the instructor marketplace.
    if (settings.messaging.enabled) learn.push({ label: l("nav.messages"), href: "/messages", icon: "MessageCircle", prefix: true, badge: counts.messages, group: "primary" });
    if (counts.peerReviews) learn.push({ label: l("nav.peerReviews"), href: "/peer-reviews", icon: "Users", prefix: true, group: "primary" });
    if (counts.managesOrg) learn.push({ label: l("nav.myTeam"), href: "/team", icon: "Building", prefix: true, group: "primary" });
    // Approved instructors keep their dashboard and earnings after applications close.
    if (settings.marketplace.enabled && (settings.marketplace.allowApplications || counts.instructor))
      learn.push({ label: l("nav.teach"), href: "/teach", icon: "Presentation", prefix: true, group: "primary" });
    if (g.affiliatesEnabled) learn.push({ label: l("nav.affiliate"), href: "/affiliate", icon: "Handshake", prefix: true, group: "more" });
    if (g.giftsEnabled) learn.push({ label: l("nav.gifts"), href: "/gift", icon: "Gift", prefix: true, group: "more" });
    // The profile lives in the avatar menu; it stays listed here for the command palette and the /you hub.
    learn.push({ label: l("nav.myProfile"), href: `/user/${user.username}`, icon: "User", prefix: true, group: "account" });
    sections.push({ key: "you", title: l("nav.section.you"), items: learn });
  }

  if (has(user, "moderator", "course_creator", "batch_evaluator")) {
    // Everyone here is staff (moderator, course creator or evaluator); some tools need a narrower role.
    const creator = has(user, "moderator", "course_creator");
    const moderator = has(user, "moderator");
    const admin = has(user, "admin");
    const manage: NavItem[] = [];
    const add = (allowed: boolean, item: NavItem) => {
      if (allowed) manage.push(item);
    };
    add(true, { label: l("nav.overview"), href: "/admin", icon: "Layout", group: "overview" });
    // Content: what learners study.
    add(creator, { label: l("nav.manageCourses"), shortLabel: l("nav.courses"), href: "/admin/courses", icon: "Book", prefix: true, group: "content" });
    add(f.batches, { label: l("nav.manageBatches"), shortLabel: l("nav.batches"), href: "/admin/batches", icon: "Users", prefix: true, group: "content" });
    add(f.programs && creator, { label: l("nav.managePrograms"), shortLabel: l("nav.programs"), href: "/admin/programs", icon: "Layers", prefix: true, group: "content" });
    add(creator, { label: l("nav.quizzes"), href: "/admin/quizzes", icon: "ListChecks", prefix: true, group: "content" });
    add(creator, { label: l("nav.questionBank"), href: "/admin/questions", icon: "Question", prefix: true, group: "content" });
    add(true, { label: l("nav.assignments"), href: "/admin/assignments", icon: "ClipboardList", prefix: true, group: "content" });
    add(true, { label: l("nav.rubrics"), href: "/admin/rubrics", icon: "ListChecks", prefix: true, group: "content" });
    add(f.programmingExercises, { label: l("nav.exercises"), href: "/admin/exercises", icon: "Code", prefix: true, group: "content" });
    // Round 3: staff can draft posts even while the public blog is switched off; the AI review queue only
    // matters once the tutor is on.
    add(creator, { label: l("nav.blog"), href: "/admin/blog", icon: "FileText", prefix: true, group: "content" });
    add(f.jobs, { label: l("nav.jobOpenings"), href: "/admin/jobs", icon: "Briefcase", prefix: true, group: "content" });
    add(settings.ai.enabled && creator, { label: l("nav.aiReview"), href: "/admin/ai", icon: "Sparkles", prefix: true, group: "content" });
    // People: members, their work waiting for a grade, and certificates.
    add(moderator, { label: l("nav.members"), href: "/admin/members", icon: "UserPlus", prefix: true, group: "people" });
    add(admin, { label: l("nav.teams"), href: "/admin/teams", icon: "Building", prefix: true, group: "people" });
    add(true, { label: l("nav.grading"), href: GRADING_HREF, icon: "Inbox", prefix: true, badge: counts.grading, group: "people" });
    add(f.certifications && has(user, "moderator", "batch_evaluator"), { label: l("nav.certificates"), href: "/admin/certificates", icon: "Certificate", prefix: true, group: "people" });
    // Business: money, growth and email.
    add(admin, { label: l("nav.analytics"), href: "/admin/analytics", icon: "BarChart", prefix: true, group: "business" });
    add(admin, { label: l("nav.sales"), href: "/admin/settings/transactions", icon: "Receipt", prefix: true, group: "business" });
    add(admin, { label: l("nav.coupons"), href: "/admin/settings/coupons", icon: "Ticket", prefix: true, group: "business" });
    add(admin, { label: l("nav.leads"), href: "/admin/leads", icon: "Target", prefix: true, group: "business" });
    add(admin && g.affiliatesEnabled, { label: l("nav.affiliates"), href: "/admin/affiliates", icon: "Handshake", prefix: true, group: "business" });
    add(moderator, { label: l("nav.emailOutbox"), href: "/admin/emails", icon: "Send", prefix: true, group: "business" });
    add(admin, { label: l("nav.settings"), href: "/admin/settings", icon: "Settings", prefix: true, group: "settings" });
    sections.push({ key: "manage", title: l("nav.section.manage"), items: manage });
  }

  const links: NavItem[] = [...settings.sidebarItems]
    .sort((a, b) => a.order - b.order)
    .map((s): NavItem => ({ label: s.label, href: s.href, icon: (s.icon as IconName) || "ExternalLink", group: "more" }));
  if (settings.contact.url) links.push({ label: l("nav.contactUs"), href: settings.contact.url, icon: "Mail", group: "more" });
  else if (settings.contact.email) links.push({ label: l("nav.contactUs"), href: `mailto:${settings.contact.email}`, icon: "Mail", group: "more" });
  if (links.length) sections.push({ key: "links", title: l("nav.section.links"), items: links });
  return sections;
}

/* ------------------------------------------------------------------------------------------------ */
/* Sidebar and top-bar view models                                                                    */
/* ------------------------------------------------------------------------------------------------ */

/** A titled block of links in the sidebar. `collapsible` groups start closed unless they hold the current page. */
export interface SidebarGroup {
  id: string;
  title?: string;
  items: NavItem[];
  collapsible?: boolean;
}

/** The sidebar's two workspaces: learning (everyone) and "Teaching & admin" (staff, everything under /admin). */
export interface SidebarNav {
  learn: SidebarGroup[];
  /** Staff only; null for learners. */
  manage: SidebarGroup[] | null;
}

/** Most always-visible learner links; the rest go into the "More" group. */
export const MAX_PRIMARY_ITEMS = 7;

/** Whether a path belongs to the staff workspace (the sidebar then shows only the Manage groups). */
export function isManagePath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/** Path part of an href (query and hash removed), used to match the current page. */
function hrefPath(href: string): string {
  return href.split(/[?#]/)[0] || href;
}

/**
 * The href of the item that marks the current page: the longest matching path wins, so
 * `/admin/settings/coupons` lights up "Coupons", not "Settings".
 */
export function activeNavHref(items: readonly Pick<NavItem, "href" | "prefix">[], pathname: string): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const item of items) {
    if (/^(https?:|mailto:)/.test(item.href)) continue;
    const path = hrefPath(item.href);
    const hit = pathname === path || (!!item.prefix && pathname.startsWith(path === "/" ? "/" : `${path}/`));
    if (hit && path.length > bestLength) {
      best = item.href;
      bestLength = path.length;
    }
  }
  return best;
}

/**
 * Split the full navigation into what the sidebar shows. Learners get at most `MAX_PRIMARY_ITEMS` links plus a
 * collapsible "More" group (account items are in the avatar menu). Staff additionally get the "Teaching &
 * admin" workspace: Overview, then Content, People, Business and Settings.
 */
export function buildSidebarNav(sections: readonly NavSection[], l: ShellLabel = englishShellLabel): SidebarNav {
  const learnItems = sections.filter((s) => s.key !== "manage").flatMap((s) => s.items);
  const primary = learnItems.filter((i) => i.group === "primary");
  const visible = primary.slice(0, MAX_PRIMARY_ITEMS);
  const more = [...primary.slice(MAX_PRIMARY_ITEMS), ...learnItems.filter((i) => i.group === "more" || i.group === undefined)];
  const learn: SidebarGroup[] = [];
  if (visible.length) learn.push({ id: "primary", items: visible });
  if (more.length) learn.push({ id: "more", title: l("nav.section.more"), items: more, collapsible: true });

  const manageSection = sections.find((s) => s.key === "manage");
  let manage: SidebarGroup[] | null = null;
  if (manageSection) {
    const pick = (group: NavGroup) => manageSection.items.filter((i) => i.group === group).map((i) => ({ ...i, label: i.shortLabel ?? i.label }));
    const groups: SidebarGroup[] = [
      { id: "overview", items: pick("overview") },
      { id: "content", title: l("nav.group.content"), items: pick("content") },
      { id: "people", title: l("nav.group.people"), items: pick("people") },
      { id: "business", title: l("nav.group.business"), items: pick("business") },
      { id: "settings", items: pick("settings") },
    ];
    manage = groups.filter((g) => g.items.length > 0);
  }
  return { learn, manage };
}

/** Links of the guest top bar: a few storefront pages up front, the other public pages in a "More" menu. */
export interface GuestNav {
  links: NavItem[];
  more: NavItem[];
}

/**
 * Guest storefront navigation: Courses, Batches, Pricing (only with plans) and Blog (only with posts) in the
 * top bar; Programs, Bundles, Jobs, Instructors and the admin's custom links under "More".
 */
export function buildGuestNav(sections: readonly NavSection[], l: ShellLabel = englishShellLabel): GuestNav {
  const items = sections.filter((s) => s.key === "main" || s.key === "links").flatMap((s) => s.items);
  const front = ["/courses", "/batches", "/pricing", "/blog"];
  const links = front
    .map((href) => items.find((i) => i.href === href))
    .filter((i): i is NavItem => !!i)
    .map((i) => (i.href === "/pricing" ? { ...i, label: l("nav.pricing") } : i));
  const more = items.filter((i) => !front.includes(i.href));
  return { links, more };
}

/* ------------------------------------------------------------------------------------------------ */
/* Simple shell navigation                                                                            */
/* ------------------------------------------------------------------------------------------------ */

/** Icon tint of a main sidebar destination (each one gets its own colour, which makes them easy to tell apart). */
export type NavTone = "blue" | "pink" | "green" | "amber" | "violet";

/** One of the few main destinations in the sidebar and on the phone tab bar. */
export interface ShellNavItem extends NavItem {
  key: "home" | "courses" | "discussions" | "messages" | "manage";
  tone: NavTone;
  /** Path prefixes that mark the item as current (Courses also lights up on batches, programs and bundles). */
  match: string[];
  /** Only the exact href marks the item as current (the guest home page "/"). */
  exact?: boolean;
}

/**
 * The whole sidebar, kept short on purpose: a handful of main destinations, the staff tools (shown under
 * "Manage" only while a page in /admin is open), the personal pages for the account menu, and the admin's own
 * links. Everything else stays reachable from the footer, the command palette (Ctrl K) and the /you hub.
 */
export interface ShellNav {
  primary: ShellNavItem[];
  /** Staff tools grouped as Overview, Content, People, Business and Settings; null for learners. */
  manage: SidebarGroup[] | null;
  /** Personal pages for the account menu (profile, peer reviews, team, teaching, affiliate, gifts). */
  account: NavItem[];
  /** The admin's custom sidebar links (Settings → Sidebar) and "Contact us". */
  custom: NavItem[];
}

/** Pages that belong to the "Courses" destination (the catalog and its sibling storefront pages). */
export const COURSES_MATCH = ["/courses", "/batches", "/programs", "/bundles", "/free", "/pricing"];

/**
 * Split the full navigation (`buildNavigation`) into the simple shell: Home, Courses, Discussions, Messages
 * (members, when messaging is on) and Manage (staff). Labels come from the same shell messages.
 */
export function buildShellNav(user: PublicUser | null, settings: Settings, sections: readonly NavSection[], l: ShellLabel = englishShellLabel): ShellNav {
  const f = settings.features;
  const all = sections.flatMap((s) => s.items);
  const find = (href: string) => all.find((i) => i.href === href);
  const primary: ShellNavItem[] = [];
  primary.push(
    user
      ? { key: "home", label: l("nav.home"), href: "/dashboard", icon: "Home", tone: "blue", match: ["/dashboard"] }
      : { key: "home", label: l("nav.home"), href: "/", icon: "Home", tone: "blue", match: [], exact: true },
  );
  if (f.courses || f.batches) {
    primary.push({ key: "courses", label: l("nav.courses"), href: f.courses ? "/courses" : "/batches", icon: "BookOpen", tone: "pink", match: COURSES_MATCH });
  }
  if (f.discussions && (f.courses || f.batches)) {
    primary.push({ key: "discussions", label: l("nav.discussions"), href: "/community", icon: "MessageSquare", tone: "green", match: ["/community"] });
  }
  const messages = user ? find("/messages") : undefined;
  if (messages) primary.push({ ...messages, key: "messages", tone: "amber", match: ["/messages"] });

  const manageSection = sections.find((s) => s.key === "manage");
  if (manageSection) {
    const grading = manageSection.items.find((i) => i.href === GRADING_HREF)?.badge;
    primary.push({ key: "manage", label: l("nav.manage"), href: "/admin", icon: "Layout", tone: "violet", match: ["/admin"], badge: grading });
  }

  const you = sections.find((s) => s.key === "you")?.items ?? [];
  const account = you.filter((i) => i.href !== "/notifications" && i.href !== "/messages");
  const custom = sections.find((s) => s.key === "links")?.items ?? [];
  return { primary, manage: buildSidebarNav(sections, l).manage, account, custom };
}

/** Whether a main destination is the current page. */
export function isShellItemActive(item: Pick<ShellNavItem, "href" | "match" | "exact">, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

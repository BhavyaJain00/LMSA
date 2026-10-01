import type { IconName } from "@/components/ui/icons";
import type { Database, Organization, PublicUser, Settings } from "@/lib/types";
import englishShell from "@/i18n/messages/en/shell";

/** Shell message keys (`src/i18n/messages/en/shell.ts`). */
export type ShellKey = keyof typeof englishShell;
/** Resolves a shell label: the server passes `await getT("shell")`; tests and defaults use English. */
export type ShellLabel = (key: ShellKey) => string;
export const englishShellLabel: ShellLabel = (key) => englishShell[key];

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Match nested routes too. */
  prefix?: boolean;
  badge?: number;
}

export interface NavSection {
  /** Stable id of the section (titles are translated, so compare keys, not titles). */
  key: "main" | "you" | "manage" | "links";
  title?: string;
  items: NavItem[];
}

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

/** Build the sidebar navigation for a viewer (mirrors Frappe LMS's role-aware sidebar), labelled in the viewer's language. */
export function buildNavigation(user: PublicUser | null, settings: Settings, counts: NavContext = {}, l: ShellLabel = englishShellLabel): NavSection[] {
  const f = settings.features;
  const main: NavItem[] = [];
  if (user) main.push({ label: l("nav.dashboard"), href: "/dashboard", icon: "Home" });
  if (f.courses) main.push({ label: l("nav.courses"), href: "/courses", icon: "BookOpen", prefix: true });
  if (f.batches) main.push({ label: l("nav.batches"), href: "/batches", icon: "Users", prefix: true });
  if (f.programs) main.push({ label: l("nav.programs"), href: "/programs", icon: "Layers", prefix: true });
  // Round 3 wave B: course bundles and membership plans are public sales pages.
  const g = settings.growth;
  if (g.bundlesEnabled && f.courses) main.push({ label: l("nav.bundles"), href: "/bundles", icon: "Gift", prefix: true });
  if (g.subscriptionsEnabled) main.push({ label: l("nav.membership"), href: "/pricing", icon: "Star" });
  if (user && f.certifications && f.certifiedMembers) main.push({ label: l("nav.certifiedMembers"), href: "/certified-members", icon: "Award" });
  if (f.jobs) main.push({ label: l("nav.jobs"), href: "/jobs", icon: "Briefcase", prefix: true });
  // Round 3: public instructor directory (guests only when they may browse the catalog).
  if (f.courses && (user || settings.learning.allowGuestAccess)) main.push({ label: l("nav.instructors"), href: "/instructors", icon: "Presentation", prefix: true });
  // Round 3: public blog (articles are always readable by guests; the switch lives in SEO settings).
  if (settings.seo.blogEnabled) main.push({ label: l("nav.blog"), href: "/blog", icon: "FileText", prefix: true });
  // Aggregate statistics are open to every member, and to guests when guest access is on; drill-downs stay staff-only on the page.
  if (f.statistics && (user || settings.learning.allowGuestAccess)) main.push({ label: l("nav.statistics"), href: "/statistics", icon: "BarChart" });
  // Round 2: the community hub gathers course/batch discussions for members; the leaderboard needs points on and
  // visible (guests only with guest access). Points history lives under /leaderboard/points (linked from the profile).
  if (user && f.discussions && (f.courses || f.batches)) main.push({ label: l("nav.community"), href: "/community", icon: "MessageSquare", prefix: true });
  if (settings.gamification.enabled && settings.gamification.showLeaderboard && (user || settings.learning.allowGuestAccess))
    main.push({ label: l("nav.leaderboard"), href: "/leaderboard", icon: "Trophy", prefix: true });

  const sections: NavSection[] = [{ key: "main", items: main }];

  if (user) {
    const learn: NavItem[] = [];
    if (f.notifications) learn.push({ label: l("nav.notifications"), href: "/notifications", icon: "Bell", badge: counts.unread });
    // Round 3 wave B: direct messages, team management, affiliate programme and the instructor marketplace.
    if (settings.messaging.enabled) learn.push({ label: l("nav.messages"), href: "/messages", icon: "MessageCircle", prefix: true, badge: counts.messages });
    if (counts.managesOrg) learn.push({ label: l("nav.myTeam"), href: "/team", icon: "Building", prefix: true });
    if (g.affiliatesEnabled) learn.push({ label: l("nav.affiliate"), href: "/affiliate", icon: "Handshake", prefix: true });
    if (counts.peerReviews) learn.push({ label: l("nav.peerReviews"), href: "/peer-reviews", icon: "Users", prefix: true });
    if (g.giftsEnabled) learn.push({ label: l("nav.gifts"), href: "/gift", icon: "Gift", prefix: true });
    // Approved instructors keep their dashboard and earnings after applications close.
    if (settings.marketplace.enabled && (settings.marketplace.allowApplications || counts.instructor)) learn.push({ label: l("nav.teach"), href: "/teach", icon: "Presentation", prefix: true });
    learn.push({ label: l("nav.myProfile"), href: `/user/${user.username}`, icon: "User", prefix: true });
    sections.push({ key: "you", title: l("nav.section.you"), items: learn });
  }

  if (has(user, "moderator", "course_creator", "batch_evaluator")) {
    const manage: NavItem[] = [];
    manage.push({ label: l("nav.overview"), href: "/admin", icon: "Layout" });
    if (has(user, "moderator", "course_creator")) manage.push({ label: l("nav.manageCourses"), href: "/admin/courses", icon: "Book", prefix: true });
    if (f.batches && has(user, "moderator", "course_creator", "batch_evaluator")) manage.push({ label: l("nav.manageBatches"), href: "/admin/batches", icon: "Users", prefix: true });
    if (f.programs && has(user, "moderator", "course_creator")) manage.push({ label: l("nav.managePrograms"), href: "/admin/programs", icon: "Layers", prefix: true });
    if (has(user, "moderator", "course_creator")) manage.push({ label: l("nav.quizzes"), href: "/admin/quizzes", icon: "ListChecks", prefix: true });
    if (has(user, "moderator", "course_creator")) manage.push({ label: l("nav.questionBank"), href: "/admin/questions", icon: "Question", prefix: true });
    if (has(user, "moderator", "course_creator", "batch_evaluator")) manage.push({ label: l("nav.assignments"), href: "/admin/assignments", icon: "ClipboardList", prefix: true, badge: counts.grading });
    if (has(user, "moderator", "course_creator", "batch_evaluator")) manage.push({ label: l("nav.rubrics"), href: "/admin/rubrics", icon: "ListChecks", prefix: true });
    if (f.programmingExercises && has(user, "moderator", "course_creator", "batch_evaluator")) manage.push({ label: l("nav.exercises"), href: "/admin/exercises", icon: "Code", prefix: true });
    if (f.certifications && has(user, "moderator", "batch_evaluator")) manage.push({ label: l("nav.certificates"), href: "/admin/certificates", icon: "Certificate", prefix: true });
    if (f.jobs && has(user, "moderator", "course_creator", "batch_evaluator")) manage.push({ label: l("nav.jobOpenings"), href: "/admin/jobs", icon: "Briefcase", prefix: true });
    // Round 3: staff can draft posts even while the public blog is switched off; the AI review queue only
    // matters once the tutor is on.
    if (has(user, "moderator", "course_creator")) manage.push({ label: l("nav.blog"), href: "/admin/blog", icon: "FileText", prefix: true });
    if (settings.ai.enabled && has(user, "moderator", "course_creator")) manage.push({ label: l("nav.aiReview"), href: "/admin/ai", icon: "Sparkles", prefix: true });
    if (has(user, "moderator")) manage.push({ label: l("nav.members"), href: "/admin/members", icon: "UserPlus", prefix: true });
    if (has(user, "moderator")) manage.push({ label: l("nav.emailOutbox"), href: "/admin/emails", icon: "Send", prefix: true });
    if (has(user, "admin")) manage.push({ label: l("nav.settings"), href: "/admin/settings", icon: "Settings", prefix: true });
    sections.push({ key: "manage", title: l("nav.section.manage"), items: manage });
  }

  const links: NavItem[] = [...settings.sidebarItems]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ label: s.label, href: s.href, icon: (s.icon as IconName) || "ExternalLink" }));
  if (settings.contact.url) links.push({ label: l("nav.contactUs"), href: settings.contact.url, icon: "Mail" });
  else if (settings.contact.email) links.push({ label: l("nav.contactUs"), href: `mailto:${settings.contact.email}`, icon: "Mail" });
  if (links.length) sections.push({ key: "links", title: l("nav.section.links"), items: links });
  return sections;
}

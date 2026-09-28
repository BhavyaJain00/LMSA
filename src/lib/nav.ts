import type { IconName } from "@/components/ui/icons";
import type { PublicUser, Settings } from "@/lib/types";

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Match nested routes too. */
  prefix?: boolean;
  badge?: number;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

function has(user: PublicUser | null, ...roles: string[]): boolean {
  if (!user) return false;
  if (user.roles.includes("admin")) return true;
  return roles.some((r) => user.roles.includes(r as PublicUser["roles"][number]));
}

/** Build the sidebar navigation for a viewer (mirrors Frappe LMS's role-aware sidebar). */
export function buildNavigation(user: PublicUser | null, settings: Settings, counts: { unread?: number; grading?: number } = {}): NavSection[] {
  const f = settings.features;
  const main: NavItem[] = [];
  if (user) main.push({ label: "Dashboard", href: "/dashboard", icon: "Home" });
  if (f.courses) main.push({ label: "Courses", href: "/courses", icon: "BookOpen", prefix: true });
  if (f.batches) main.push({ label: "Batches", href: "/batches", icon: "Users", prefix: true });
  if (f.programs) main.push({ label: "Programs", href: "/programs", icon: "Layers", prefix: true });
  if (f.certifications && f.certifiedMembers) main.push({ label: "Certified Members", href: "/certified-members", icon: "Award" });
  if (f.jobs) main.push({ label: "Jobs", href: "/jobs", icon: "Briefcase", prefix: true });
  if (f.statistics && has(user, "moderator", "course_creator")) main.push({ label: "Statistics", href: "/statistics", icon: "BarChart" });

  const sections: NavSection[] = [{ items: main }];

  if (user) {
    const learn: NavItem[] = [];
    if (f.notifications) learn.push({ label: "Notifications", href: "/notifications", icon: "Bell", badge: counts.unread });
    learn.push({ label: "My Profile", href: `/user/${user.username}`, icon: "User", prefix: true });
    sections.push({ title: "You", items: learn });
  }

  if (has(user, "moderator", "course_creator", "batch_evaluator")) {
    const manage: NavItem[] = [];
    manage.push({ label: "Overview", href: "/admin", icon: "Layout" });
    if (has(user, "moderator", "course_creator")) manage.push({ label: "Manage Courses", href: "/admin/courses", icon: "Book", prefix: true });
    if (f.batches && has(user, "moderator", "course_creator", "batch_evaluator")) manage.push({ label: "Manage Batches", href: "/admin/batches", icon: "Users", prefix: true });
    if (f.programs && has(user, "moderator")) manage.push({ label: "Manage Programs", href: "/admin/programs", icon: "Layers", prefix: true });
    if (has(user, "moderator", "course_creator")) manage.push({ label: "Quizzes", href: "/admin/quizzes", icon: "ListChecks", prefix: true });
    if (has(user, "moderator", "course_creator", "batch_evaluator")) manage.push({ label: "Assignments", href: "/admin/assignments", icon: "ClipboardList", prefix: true, badge: counts.grading });
    if (f.programmingExercises && has(user, "moderator", "course_creator")) manage.push({ label: "Exercises", href: "/admin/exercises", icon: "Code", prefix: true });
    if (f.certifications && has(user, "moderator", "batch_evaluator")) manage.push({ label: "Certificates", href: "/admin/certificates", icon: "Certificate", prefix: true });
    if (f.jobs && has(user, "moderator")) manage.push({ label: "Job Openings", href: "/admin/jobs", icon: "Briefcase", prefix: true });
    if (has(user, "moderator")) manage.push({ label: "Members", href: "/admin/members", icon: "UserPlus", prefix: true });
    if (has(user, "admin")) manage.push({ label: "Settings", href: "/admin/settings", icon: "Settings", prefix: true });
    sections.push({ title: "Manage", items: manage });
  }

  const links: NavItem[] = [...settings.sidebarItems]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ label: s.label, href: s.href, icon: (s.icon as IconName) || "ExternalLink" }));
  if (settings.contact.url) links.push({ label: "Contact us", href: settings.contact.url, icon: "Mail" });
  else if (settings.contact.email) links.push({ label: "Contact us", href: `mailto:${settings.contact.email}`, icon: "Mail" });
  if (links.length) sections.push({ title: "Links", items: links });
  return sections;
}

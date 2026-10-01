import type { IconName } from "@/components/ui/icons";
import type { PublicUser, Settings } from "@/lib/types";
import { buildNavigation } from "@/lib/nav";

export type SearchScope = "courses" | "transcripts" | "batches" | "programs" | "jobs" | "quizzes" | "assignments" | "people";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  updatedAt?: string;
  /** Character indices of the title that matched the query. */
  indices: number[];
}

export interface SearchResultGroup {
  key: SearchScope;
  label: string;
  items: SearchResultItem[];
}

export interface PaletteCommand {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  group: string;
  keywords?: string;
}

export interface PaletteScope {
  key: SearchScope;
  label: string;
  icon: IconName;
  viewAllHref: string;
}

export interface PaletteConfig {
  signedIn: boolean;
  commands: PaletteCommand[];
  scopes: PaletteScope[];
}

function has(user: PublicUser | null, ...roles: string[]): boolean {
  if (!user) return false;
  if (user.roles.includes("admin")) return true;
  return roles.some((r) => user.roles.includes(r as PublicUser["roles"][number]));
}

/**
 * Build the palette's navigation targets and search categories from the same
 * role/feature-aware navigation the sidebar uses, so the palette never offers
 * something the sidebar hides.
 */
export function buildPaletteConfig(user: PublicUser | null, settings: Settings): PaletteConfig {
  const f = settings.features;
  const commands: PaletteCommand[] = [];
  const seen = new Set<string>();
  for (const section of buildNavigation(user, settings)) {
    const group = section.title === "Manage" ? "Manage" : section.title === "Links" ? "Links" : "Jump to";
    for (const item of section.items) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      commands.push({ id: `nav:${item.href}`, label: item.label, href: item.href, icon: item.icon, group });
    }
  }

  if (user) {
    const staffLinks: [boolean, PaletteCommand][] = [
      [has(user, "moderator", "course_creator") && f.courses, { id: "new-course", label: "Create a course", href: "/admin/courses/new", icon: "Plus", group: "Manage", keywords: "new add" }],
      [has(user, "moderator", "course_creator"), { id: "question-bank", label: "Question bank", href: "/admin/questions", icon: "Question", group: "Manage" }],
      [
        has(user, "moderator", "course_creator", "batch_evaluator"),
        { id: "grading", label: "Submissions to grade", href: "/admin/assignments/submissions?status=not_graded", icon: "Inbox", group: "Manage", keywords: "grade review" },
      ],
      [has(user, "moderator", "course_creator"), { id: "quiz-submissions", label: "Quiz submissions", href: "/admin/quizzes/submissions", icon: "Target", group: "Manage" }],
    ];
    for (const [allowed, cmd] of staffLinks) if (allowed && !seen.has(cmd.href)) commands.push(cmd);

    commands.push(
      { id: "account-settings", label: "Account settings", href: "/settings", icon: "Settings", group: "Account", keywords: "password theme sessions" },
      { id: "edit-profile", label: "Edit profile", href: `/user/${user.username}/edit`, icon: "Edit", group: "Account", keywords: "avatar bio" },
      { id: "persona", label: "Learning goals", href: "/persona", icon: "Target", group: "Account", keywords: "persona onboarding" },
    );
    if (has(user, "admin")) {
      commands.push({ id: "site-settings", label: "Site settings", href: "/admin/settings", icon: "Sliders", group: "Account", keywords: "branding features" });
    }
  } else {
    commands.push(
      { id: "login", label: "Log in", href: "/login", icon: "LogIn", group: "Account" },
      { id: "register", label: "Create an account", href: "/register", icon: "UserPlus", group: "Account", keywords: "sign up" },
    );
  }

  const scopes: PaletteScope[] = [];
  if (f.courses) scopes.push({ key: "courses", label: "Courses", icon: "BookOpen", viewAllHref: "/courses" });
  if (f.courses) scopes.push({ key: "transcripts", label: "Video transcripts", icon: "Captions", viewAllHref: "/courses" });
  if (f.batches) scopes.push({ key: "batches", label: "Batches", icon: "Users", viewAllHref: "/batches" });
  if (f.programs) scopes.push({ key: "programs", label: "Programs", icon: "Layers", viewAllHref: "/programs" });
  if (f.jobs) scopes.push({ key: "jobs", label: "Jobs", icon: "Briefcase", viewAllHref: "/jobs" });
  if (has(user, "moderator", "course_creator")) {
    scopes.push({ key: "quizzes", label: "Quizzes", icon: "ListChecks", viewAllHref: "/admin/quizzes" });
    scopes.push({ key: "assignments", label: "Assignments", icon: "ClipboardList", viewAllHref: "/admin/assignments" });
  }
  if (user) scopes.push({ key: "people", label: "People", icon: "User", viewAllHref: has(user, "moderator") ? "/admin/members" : "/certified-members" });

  return { signedIn: !!user, commands, scopes };
}

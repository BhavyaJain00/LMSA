import { gateSection } from "@/lib/auth/section-gate";

/**
 * Program management is for moderators and instructors (a program's own page
 * further requires having created it, see `canManageProgram`). Checking the
 * role here, outside the section's loading screen, gives other members a real
 * redirect to /forbidden instead of a page that redirects after it starts
 * streaming. Every page re-checks.
 */
export default async function AdminProgramsLayout({ children }: LayoutProps<"/admin/programs">) {
  await gateSection(["moderator", "course_creator"]);
  return children;
}

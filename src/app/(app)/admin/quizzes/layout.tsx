import { gateSection } from "@/lib/auth/section-gate";

/**
 * Quiz management is for instructors and moderators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminQuizzesLayout({ children }: LayoutProps<"/admin/quizzes">) {
  await gateSection(["course_creator", "moderator"]);
  return children;
}

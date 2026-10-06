import { gateSection } from "@/lib/auth/section-gate";

/**
 * The AI tutor review area is for moderators and instructors. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminAiLayout({ children }: LayoutProps<"/admin/ai">) {
  await gateSection(["moderator", "course_creator"]);
  return children;
}

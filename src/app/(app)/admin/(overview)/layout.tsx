import { gateSection } from "@/lib/auth/section-gate";

/**
 * The admin overview is for staff (instructors, moderators and evaluators). Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminOverviewLayout({ children }: LayoutProps<"/admin">) {
  await gateSection(["course_creator", "moderator", "batch_evaluator"]);
  return children;
}

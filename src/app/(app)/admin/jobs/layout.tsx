import { gateSection } from "@/lib/auth/section-gate";

/**
 * Job board management is for staff (instructors, moderators and evaluators). Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminJobsLayout({ children }: LayoutProps<"/admin/jobs">) {
  await gateSection(["course_creator", "moderator", "batch_evaluator"]);
  return children;
}

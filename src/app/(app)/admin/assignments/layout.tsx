import { gateSectionWith } from "@/lib/auth/section-gate";
import { canManageAssessments } from "@/lib/data/assessments";

/**
 * Assignment management is for staff; learners are sent to the catalog.
 * Checking it here, outside the section's loading screen, gives other members
 * a real redirect to /courses instead of a page that redirects after it starts
 * streaming. Every page re-checks.
 */
export default async function AdminAssignmentsLayout({ children }: LayoutProps<"/admin/assignments">) {
  await gateSectionWith(canManageAssessments, "/courses");
  return children;
}

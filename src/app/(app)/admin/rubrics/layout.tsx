import { gateSectionWith } from "@/lib/auth/section-gate";
import { canUseRubrics } from "@/lib/teaching/rubrics";

/**
 * Rubrics are for staff; learners are sent to the catalog.
 * Checking it here, outside the section's loading screen, gives other members
 * a real redirect to /courses instead of a page that redirects after it starts
 * streaming. Every page re-checks.
 */
export default async function AdminRubricsLayout({ children }: LayoutProps<"/admin/rubrics">) {
  await gateSectionWith(canUseRubrics, "/courses");
  return children;
}

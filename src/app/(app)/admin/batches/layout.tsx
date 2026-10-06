import { gateSection } from "@/lib/auth/section-gate";

/**
 * Batch management is for moderators, instructors and evaluators (a batch's
 * own page further requires being one of its instructors, see
 * `canManageBatch`). Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminBatchesLayout({ children }: LayoutProps<"/admin/batches">) {
  await gateSection(["moderator", "course_creator", "batch_evaluator"]);
  return children;
}

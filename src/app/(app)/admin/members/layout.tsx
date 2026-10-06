import { gateSection } from "@/lib/auth/section-gate";

/**
 * Member management is for moderators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminMembersLayout({ children }: LayoutProps<"/admin/members">) {
  await gateSection(["moderator"]);
  return children;
}

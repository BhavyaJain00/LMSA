import { gateSection } from "@/lib/auth/section-gate";

/**
 * Email broadcasts is for moderators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminBroadcastsLayout({ children }: LayoutProps<"/admin/broadcasts">) {
  await gateSection(["moderator"]);
  return children;
}

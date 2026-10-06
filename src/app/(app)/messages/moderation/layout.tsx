import { gateSection } from "@/lib/auth/section-gate";

/**
 * Message moderation is for moderators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function MessageModerationLayout({ children }: LayoutProps<"/messages/moderation">) {
  await gateSection(["moderator"]);
  return children;
}

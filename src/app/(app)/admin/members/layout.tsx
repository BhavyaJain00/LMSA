import { gateSection } from "@/lib/auth/section-gate";
import { AdminI18n } from "@/components/admin/i18n";

/**
 * Member management is for moderators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks. The member list, forms and
 * import read the `members.` messages on the client.
 */
export default async function AdminMembersLayout({ children }: LayoutProps<"/admin/members">) {
  await gateSection(["moderator"]);
  return <AdminI18n section="members">{children}</AdminI18n>;
}

import { gateSection } from "@/lib/auth/section-gate";

/**
 * Account security monitoring is for administrators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminSecurityLayout({ children }: LayoutProps<"/admin/security">) {
  await gateSection(["admin"]);
  return children;
}

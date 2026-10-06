import { gateSection } from "@/lib/auth/section-gate";

/**
 * The audit log is for administrators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminAuditLayout({ children }: LayoutProps<"/admin/audit">) {
  await gateSection(["admin"]);
  return children;
}

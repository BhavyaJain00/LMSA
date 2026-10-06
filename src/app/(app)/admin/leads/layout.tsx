import { gateSection } from "@/lib/auth/section-gate";

/**
 * Lead capture is for administrators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminLeadsLayout({ children }: LayoutProps<"/admin/leads">) {
  await gateSection(["admin"]);
  return children;
}

import { gateSection } from "@/lib/auth/section-gate";

/**
 * The instructor marketplace is for administrators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminMarketplaceLayout({ children }: LayoutProps<"/admin/marketplace">) {
  await gateSection(["admin"]);
  return children;
}

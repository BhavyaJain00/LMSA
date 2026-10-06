import { gateSection } from "@/lib/auth/section-gate";

/**
 * The error log is for administrators. Checking the role here, outside the section's loading
 * screen, gives other members a real redirect to /forbidden instead of a page
 * that redirects after it starts streaming. Every page re-checks.
 */
export default async function AdminErrorsLayout({ children }: LayoutProps<"/admin/errors">) {
  await gateSection(["admin"]);
  return children;
}

import { gateSectionWith } from "@/lib/auth/section-gate";
import { canIssueCertificates } from "@/lib/data/certificates";

/**
 * Issuing certificates is for moderators and evaluators.
 * Checking it here, outside the section's loading screen, gives other members
 * a real redirect to /forbidden instead of a page that redirects after it starts
 * streaming. Every page re-checks.
 */
export default async function AdminCertificatesLayout({ children }: LayoutProps<"/admin/certificates">) {
  await gateSectionWith(canIssueCertificates, "/forbidden");
  return children;
}

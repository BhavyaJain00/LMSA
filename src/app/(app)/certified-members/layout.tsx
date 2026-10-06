import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";

/**
 * The certified-members directory is for signed-in members (guests are sent to
 * the course catalog) and only exists while certificates and the directory are
 * switched on. These checks run here, outside the page's loading screen, so a
 * guest gets a real 307 and a disabled directory a real 404 instead of a
 * streamed 200 that redirects in the browser. The page repeats them.
 */
export default async function CertifiedMembersLayout({ children }: LayoutProps<"/certified-members">) {
  const settings = await getSettings();
  if (!settings.features.certifications || !settings.features.certifiedMembers) notFound();
  if (!(await getCurrentUser())) redirect("/courses");
  return children;
}

import { AnalyticsBeacon } from "@/components/analytics/analytics-beacon";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { buildPaletteConfig } from "@/components/command-palette/config";
import { SiteFooter } from "@/components/marketing/site-footer";
import { LandingHeader } from "@/components/landing3d/landing-header";
import { SceneCanvas } from "@/components/landing3d/scene-canvas";
import { getCurrentPublicUser } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { buildGuestNav, buildNavigation, navContentCounts } from "@/lib/nav";
import { getT } from "@/i18n/server";

/**
 * The guest landing page's own frame: no sidebar, a glass top bar, the full-page 3D scene behind the content
 * and the site footer. (Signed-in visitors are sent to their home page by the page itself.)
 */
export default async function LandingLayout({ children }: LayoutProps<"/">) {
  const [user, settings, shell, db] = await Promise.all([getCurrentPublicUser(), getSettings(), getT("shell"), getDb()]);
  const sections = buildNavigation(user, settings, { content: navContentCounts(db) }, shell);
  const { links } = buildGuestNav(sections, shell);
  const palette = buildPaletteConfig(user, settings, shell);
  return (
    <>
      {/* overflow-x-clip: sections swinging in (3D) and decorative glows never widen the page on phones. */}
      <div className="relative flex min-h-screen flex-col overflow-x-clip bg-surface">
        <SceneCanvas />
        <LandingHeader
          brand={{ name: settings.brand.name, logoUrl: settings.brand.logoUrl }}
          links={links.map((link) => ({ href: link.href, label: link.label }))}
          signupEnabled={!settings.learning.disableSignup}
        />
        <main id="main-content" className="relative z-10 flex-1">
          {children}
        </main>
        <div className="relative z-10">
          <SiteFooter />
        </div>
      </div>
      <CommandPalette {...palette} />
      <AnalyticsBeacon />
    </>
  );
}

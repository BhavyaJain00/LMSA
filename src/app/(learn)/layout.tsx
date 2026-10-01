import { AnalyticsBeacon } from "@/components/analytics/analytics-beacon";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { buildPaletteConfig } from "@/components/command-palette/config";
import { getCurrentPublicUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";

/**
 * Full-width frame for the lesson player. Pages in this group do not get the
 * app shell (sidebar + header); the course-aware top bar is rendered by
 * `courses/[slug]/learn/layout.tsx`, which knows which course is open.
 * The command palette (Ctrl K / ⌘K) and the first-party analytics beacon are
 * mounted here too, as in the (app) group.
 */
export default async function LearnGroupLayout({ children }: LayoutProps<"/">) {
  const [user, settings] = await Promise.all([getCurrentPublicUser(), getSettings()]);
  const palette = buildPaletteConfig(user, settings);
  return (
    <>
      <div className="flex min-h-screen flex-col bg-surface">
        <a
          href="#lesson-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface-1 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-pop"
        >
          Skip to lesson content
        </a>
        {children}
      </div>
      <CommandPalette {...palette} />
      <AnalyticsBeacon />
    </>
  );
}

import { AnalyticsBeacon } from "@/components/analytics/analytics-beacon";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { buildPaletteConfig } from "@/components/command-palette/config";
import { getCurrentPublicUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getT } from "@/i18n/server";
import { I18nProvider } from "@/i18n/provider";

/**
 * Message slices the lesson player needs on the client. `global.player.` (the video and audio
 * player) is not in the root layout's slice, so it is provided here.
 */
const LEARN_PICK = { learning: ["learn.", "global.player.", "quiz.", "assignment.", "exercise.", "ai."] } as const;

/**
 * Full-width frame for the lesson player. Pages in this group do not get the
 * app shell (sidebar + header); the course-aware top bar is rendered by
 * `courses/[slug]/learn/layout.tsx`, which knows which course is open.
 * The command palette (Ctrl K / ⌘K) and the first-party analytics beacon are
 * mounted here too, as in the (app) group.
 */
export default async function LearnGroupLayout({ children }: LayoutProps<"/">) {
  const [user, settings, t, shell] = await Promise.all([getCurrentPublicUser(), getSettings(), getT("learning"), getT("shell")]);
  const palette = buildPaletteConfig(user, settings, shell);
  return (
    <I18nProvider namespaces={["learning"]} pick={LEARN_PICK}>
      <div className="flex min-h-screen flex-col bg-surface">
        <a
          href="#lesson-main"
          className="sr-only focus:not-sr-only focus:fixed focus:inset-s-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface-1 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-pop"
        >
          {t("learn.skipToContent")}
        </a>
        {children}
      </div>
      <CommandPalette {...palette} />
      <AnalyticsBeacon />
    </I18nProvider>
  );
}

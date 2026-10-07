import "server-only";
import { englishMessages } from "@/i18n/catalog";

/**
 * Which slices of the `admin` namespace each part of /admin hands to the
 * browser. Client components under /admin read `useT("admin")`; sending the
 * whole namespace (about a thousand client messages, 68 KB in English and
 * twice that in Hindi) on every admin page would bloat every response, so
 * each route's layout provides only the key prefixes its client components
 * use. Nested providers merge key by key, so a route gets its own slices plus
 * those of the layouts above it:
 *
 *   base                app/(app)/admin/layout.tsx                 error boundaries, shared words, member picker
 *   members             app/(app)/admin/members/layout.tsx         member list, forms and import
 *   settings            app/(app)/admin/settings/layout.tsx        the settings sub-navigation
 *   settings<Page>      app/(app)/admin/settings/<page>/layout.tsx that settings page's form
 *   developers          app/(app)/developers/layout.tsx            the API reference (outside /admin)
 *
 * Keys under `pages.` are only rendered by Server Components (headings,
 * metadata, server-built labels) and `global.` keys come from the root
 * layout, so neither is ever listed here. A new client area of the `admin`
 * namespace must be added to the section of the route that renders it:
 * `tests/i18n-payload.test.ts` fails for a prefix no section provides, and
 * for a client component whose keys its route's layouts do not provide.
 */
const SECTIONS = {
  base: ["errorPages.", "shared.", "memberPicker."],
  members: ["members."],
  settings: ["settingsNav."],
  settingsAi: ["aiForm."],
  settingsBadges: ["badges."],
  settingsBranding: ["brandingForm."],
  settingsCategories: ["categories."],
  settingsData: ["backups.", "dataPanel."],
  settingsEmail: ["emailSettingsForm.", "notificationTypes."],
  settingsFeatures: ["featuresForm."],
  settingsGamification: ["gamificationForm.", "pointsReasons."],
  settingsGeneral: ["generalForm."],
  settingsLearning: ["learningForm."],
  settingsPayments: ["paymentsForm.", "gateways."],
  settingsPwa: ["pwaForm."],
  settingsSecurity: ["securityForm."],
  settingsSeo: ["seoForm."],
  settingsSidebar: ["sidebarManager."],
  settingsStorage: ["storageForm.", "gateways."],
  settingsVideo: ["videoForm."],
  developers: ["developers.", "errorPages."],
} as const satisfies Record<string, readonly string[]>;

export type AdminSection = keyof typeof SECTIONS;

/** Every section, for checks. */
export const ADMIN_SECTIONS = Object.keys(SECTIONS) as AdminSection[];

/** Top-level `admin` areas that are never sent from an admin layout. */
const SERVER_OR_ROOT = new Set(["pages", "global"]);

let allPrefixes: string[] | null = null;

/** Every top-level `<area>.` prefix of the `admin` namespace that client components may read. */
export function adminClientPrefixes(): string[] {
  if (!allPrefixes) {
    const prefixes = new Set<string>();
    for (const key of Object.keys(englishMessages("admin"))) {
      const dot = key.indexOf(".");
      const head = dot > 0 ? key.slice(0, dot) : "";
      if (head && !SERVER_OR_ROOT.has(head)) prefixes.add(`${head}.`);
    }
    allPrefixes = [...prefixes].sort();
  }
  return allPrefixes;
}

/** The `admin` key prefixes a section's layout provides (nested sections add to their parents). */
export function adminClientSlices(section: AdminSection): readonly string[] {
  return SECTIONS[section];
}

import "server-only";
import { englishMessages } from "@/i18n/catalog";

/**
 * Which slices of the `admin` namespace each part of /admin hands to the
 * browser. Client components under /admin read `useT("admin")`; sending the
 * whole namespace on every admin page would serialize about a thousand
 * messages, so each section's layout provides only the key prefixes its
 * client components use:
 *
 *   base            app/(app)/admin/layout.tsx         error boundaries, shared words, member picker
 *   members         app/(app)/admin/members/layout.tsx member list, forms and import
 *   settings        app/(app)/admin/settings/layout.tsx every settings form (and the API pages' code samples)
 *   settingsData    app/(app)/admin/settings/data/layout.tsx  backups and data export/import
 *   settingsBadges  app/(app)/admin/settings/badges/layout.tsx badge manager and assignments
 *
 * `settings` gets every client prefix that no other section claims, so a new
 * settings form's keys are provided without editing this file. Keys under
 * `pages.` are only rendered by Server Components (headings, metadata,
 * server-built labels) and `global.` keys come from the root layout, so
 * neither is ever listed here.
 */
export type AdminSection = "base" | "members" | "settings" | "settingsData" | "settingsBadges";

/** Top-level `admin` areas that are never sent from an admin layout. */
const SERVER_OR_ROOT = new Set(["pages", "global"]);

/** Prefixes claimed by a section; everything else that client components use goes to `settings`. */
const CLAIMED: Record<Exclude<AdminSection, "settings">, readonly string[]> = {
  base: ["errorPages.", "shared.", "memberPicker."],
  members: ["members."],
  settingsData: ["backups.", "dataPanel."],
  settingsBadges: ["badges."],
};

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

const sectionCache = new Map<AdminSection, readonly string[]>();

/** The `admin` key prefixes a section's layout provides (nested sections add to their parents). */
export function adminClientSlices(section: AdminSection): readonly string[] {
  let slices = sectionCache.get(section);
  if (!slices) {
    if (section === "settings") {
      const claimed = new Set(Object.values(CLAIMED).flat());
      slices = adminClientPrefixes().filter((prefix) => !claimed.has(prefix));
    } else {
      slices = CLAIMED[section];
    }
    sectionCache.set(section, slices);
  }
  return slices;
}

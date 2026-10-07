import "server-only";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";
import { adminClientSlices, type AdminSection } from "./i18n-slices";

export { adminClientSlices, adminClientPrefixes, type AdminSection } from "./i18n-slices";

/**
 * Provides one section's slices of the `admin` namespace to the client
 * components below it (see `./i18n-slices.ts` for which section gets what).
 * Nested providers merge key by key, so a section layout adds to the
 * `base` slices the admin layout provides.
 */
export function AdminI18n({ section, children }: { section: AdminSection; children: ReactNode }) {
  return (
    <I18nProvider namespaces={["admin"]} pick={{ admin: adminClientSlices(section) }}>
      {children}
    </I18nProvider>
  );
}

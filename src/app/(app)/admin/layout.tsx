import { I18nProvider } from "@/i18n/provider";
import { adminClientSlices } from "@/components/admin/i18n";

/**
 * Admin shell: makes the `admin` messages that client components read with
 * `useT("admin")` available below /admin. Server-only text (the `pages.`
 * slice) stays on the server; every page re-checks roles itself.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <I18nProvider namespaces={["admin"]} pick={{ admin: adminClientSlices() }}>
      {children}
    </I18nProvider>
  );
}

import { AdminI18n } from "@/components/admin/i18n";

/** Hands the general settings form's messages (`generalForm.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminGeneralSettingsLayout({ children }: LayoutProps<"/admin/settings/general">) {
  return <AdminI18n section="settingsGeneral">{children}</AdminI18n>;
}

import { AdminI18n } from "@/components/admin/i18n";

/** Hands the branding form's messages (`brandingForm.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminBrandingSettingsLayout({ children }: LayoutProps<"/admin/settings/branding">) {
  return <AdminI18n section="settingsBranding">{children}</AdminI18n>;
}

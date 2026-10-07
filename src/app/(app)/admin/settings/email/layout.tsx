import { AdminI18n } from "@/components/admin/i18n";

/** Hands the email settings form's messages (`emailSettingsForm.`, `notificationTypes.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminEmailSettingsLayout({ children }: LayoutProps<"/admin/settings/email">) {
  return <AdminI18n section="settingsEmail">{children}</AdminI18n>;
}

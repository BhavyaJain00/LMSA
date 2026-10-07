import { AdminI18n } from "@/components/admin/i18n";

/** Hands the video settings form's messages (`videoForm.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminVideoSettingsLayout({ children }: LayoutProps<"/admin/settings/video">) {
  return <AdminI18n section="settingsVideo">{children}</AdminI18n>;
}

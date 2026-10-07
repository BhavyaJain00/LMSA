import { AdminI18n } from "@/components/admin/i18n";

/** Hands the gamification form's messages (`gamificationForm.`, `pointsReasons.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminGamificationSettingsLayout({ children }: LayoutProps<"/admin/settings/gamification">) {
  return <AdminI18n section="settingsGamification">{children}</AdminI18n>;
}

import { AdminI18n } from "@/components/admin/i18n";

/** Hands the learning settings form's messages (`learningForm.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminLearningSettingsLayout({ children }: LayoutProps<"/admin/settings/learning">) {
  return <AdminI18n section="settingsLearning">{children}</AdminI18n>;
}

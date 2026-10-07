import { AdminI18n } from "@/components/admin/i18n";

/** Hands the AI settings form's messages (`aiForm.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminAiSettingsLayout({ children }: LayoutProps<"/admin/settings/ai">) {
  return <AdminI18n section="settingsAi">{children}</AdminI18n>;
}

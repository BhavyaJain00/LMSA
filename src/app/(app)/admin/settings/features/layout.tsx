import { AdminI18n } from "@/components/admin/i18n";

/** Hands the feature switches' messages (`featuresForm.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminFeaturesSettingsLayout({ children }: LayoutProps<"/admin/settings/features">) {
  return <AdminI18n section="settingsFeatures">{children}</AdminI18n>;
}

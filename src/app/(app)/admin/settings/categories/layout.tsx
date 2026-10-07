import { AdminI18n } from "@/components/admin/i18n";

/** Hands the category manager's messages (`categories.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminCategoriesSettingsLayout({ children }: LayoutProps<"/admin/settings/categories">) {
  return <AdminI18n section="settingsCategories">{children}</AdminI18n>;
}

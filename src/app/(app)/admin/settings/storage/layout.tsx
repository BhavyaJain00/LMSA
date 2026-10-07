import { AdminI18n } from "@/components/admin/i18n";

/** Hands the storage settings form's messages (`storageForm.`, `gateways.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminStorageSettingsLayout({ children }: LayoutProps<"/admin/settings/storage">) {
  return <AdminI18n section="settingsStorage">{children}</AdminI18n>;
}

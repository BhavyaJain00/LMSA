import { AdminI18n } from "@/components/admin/i18n";

/** Hands the payment settings and gateway panel's messages (`paymentsForm.`, `gateways.`) to this page's client components (see `src/components/admin/i18n-slices.ts`). */
export default function AdminPaymentsSettingsLayout({ children }: LayoutProps<"/admin/settings/payments">) {
  return <AdminI18n section="settingsPayments">{children}</AdminI18n>;
}

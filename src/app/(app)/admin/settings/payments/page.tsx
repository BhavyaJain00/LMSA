import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { PaymentsForm } from "@/components/admin/settings/payments-form";

export const metadata = { title: "Payment settings" };

export default async function PaymentSettingsPage() {
  await requireRole(["admin"], "/admin/settings/payments");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader
        title="Payments"
        description={
          <>
            Currency, gateway, tax and reminders. Review orders in{" "}
            <Link href="/admin/settings/transactions" className="font-medium text-accent hover:underline">
              Transactions
            </Link>{" "}
            and discount codes in{" "}
            <Link href="/admin/settings/coupons" className="font-medium text-accent hover:underline">
              Coupons
            </Link>
            .
          </>
        }
      />
      <PaymentsForm initial={settings.commerce} />
    </>
  );
}

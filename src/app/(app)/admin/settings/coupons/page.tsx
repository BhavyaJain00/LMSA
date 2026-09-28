import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getCoupons, getPurchasableItems } from "@/lib/data/commerce";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { CouponsManager } from "@/components/commerce/coupons-manager";
import { toDateKey } from "@/lib/utils";

export const metadata = { title: "Coupons" };

export default async function CouponsSettingsPage() {
  await requireRole(["admin"], "/admin/settings/coupons");
  const [coupons, targets, settings] = await Promise.all([getCoupons(), getPurchasableItems(), getSettings()]);
  return (
    <>
      <SettingsPanelHeader title="Coupons" description="Discount codes learners can apply at checkout." />
      <CouponsManager coupons={coupons} targets={targets} currency={settings.commerce.defaultCurrency} today={toDateKey()} />
    </>
  );
}

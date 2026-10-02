import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getCoupons, getPurchasableItems } from "@/lib/data/commerce";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { CouponsManager } from "@/components/commerce/coupons-manager";
import { toDateKey } from "@/lib/utils";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.coupons.metaTitle") };
}

export default async function CouponsSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/coupons");
  const [coupons, targets, settings] = await Promise.all([getCoupons(), getPurchasableItems(), getSettings()]);
  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.coupons.title")} description={t("pages.settings.coupons.description")} />
      <CouponsManager coupons={coupons} targets={targets} currency={settings.commerce.defaultCurrency} today={toDateKey()} />
    </>
  );
}

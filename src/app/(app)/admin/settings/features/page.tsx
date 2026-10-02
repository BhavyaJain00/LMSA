import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { FeaturesForm } from "@/components/admin/settings/features-form";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.features.metaTitle") };
}

export default async function FeatureSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/features");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.features.title")} description={t("pages.settings.features.description")} />
      <FeaturesForm initial={settings.features} />
    </>
  );
}

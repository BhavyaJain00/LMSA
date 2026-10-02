import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { BrandingForm } from "@/components/admin/settings/branding-form";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.branding.metaTitle") };
}

export default async function BrandingSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/branding");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.branding.title")} description={t("pages.settings.branding.description")} />
      <BrandingForm
        initial={{
          brandName: settings.brand.name,
          logoUrl: settings.brand.logoUrl ?? "",
          faviconUrl: settings.brand.faviconUrl ?? "",
          accentColor: settings.brand.accentColor,
        }}
      />
    </>
  );
}

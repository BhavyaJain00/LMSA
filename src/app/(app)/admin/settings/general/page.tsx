import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { GeneralSettingsForm } from "@/components/admin/settings/general-form";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.general.metaTitle") };
}

export default async function GeneralSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/general");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.general.title")} description={t("pages.settings.general.description")} />
      <GeneralSettingsForm
        initial={{
          name: settings.brand.name,
          tagline: settings.brand.tagline,
          footerText: settings.brand.footerText ?? "",
          contactEmail: settings.contact.email ?? "",
          contactUrl: settings.contact.url ?? "",
          textDirection: settings.textDirection,
        }}
      />
    </>
  );
}

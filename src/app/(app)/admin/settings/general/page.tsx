import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { GeneralSettingsForm } from "@/components/admin/settings/general-form";

export const metadata = { title: "General settings" };

export default async function GeneralSettingsPage() {
  await requireRole(["admin"], "/admin/settings/general");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader title="General" description="Brand name, tagline, footer, contact details and text direction." />
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

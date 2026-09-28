import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { BrandingForm } from "@/components/admin/settings/branding-form";

export const metadata = { title: "Brand settings" };

export default async function BrandingSettingsPage() {
  await requireRole(["admin"], "/admin/settings/branding");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader title="Brand Settings" description="Logo, favicon and the accent color used across the app." />
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

import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { FeaturesForm } from "@/components/admin/settings/features-form";

export const metadata = { title: "Features" };

export default async function FeatureSettingsPage() {
  await requireRole(["admin"], "/admin/settings/features");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader title="Features" description="Switch whole areas of the platform on or off." />
      <FeaturesForm initial={settings.features} />
    </>
  );
}

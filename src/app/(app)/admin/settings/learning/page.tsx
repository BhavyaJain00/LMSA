import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { LearningForm } from "@/components/admin/settings/learning-form";

export const metadata = { title: "Learning settings" };

export default async function LearningSettingsPage() {
  await requireRole(["admin"], "/admin/settings/learning");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader title="Learning" description="Access, signup and the rules that decide when a lesson counts as complete." />
      <LearningForm initial={{ ...settings.learning, customSignupContent: settings.customSignupContent ?? "" }} />
    </>
  );
}

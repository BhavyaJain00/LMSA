import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { LearningForm } from "@/components/admin/settings/learning-form";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.learning.metaTitle") };
}

export default async function LearningSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/learning");
  const settings = await getSettings();
  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.learning.title")} description={t("pages.settings.learning.description")} />
      <LearningForm initial={{ ...settings.learning, customSignupContent: settings.customSignupContent ?? "" }} />
    </>
  );
}

import { headers } from "next/headers";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { SeoForm } from "@/components/admin/settings/seo-form";

export const metadata = { title: "SEO settings" };

export default async function SeoSettingsPage() {
  await requireRole(["admin"], "/admin/settings/seo");
  const [settings, h] = await Promise.all([getSettings(), headers()]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return (
    <>
      <SettingsPanelHeader title="SEO" description="Default meta description, keywords and social image." />
      <SeoForm
        initial={{
          brandName: settings.brand.name,
          siteUrl: `${proto}://${host}`,
          metaDescription: settings.brand.metaDescription ?? "",
          metaKeywords: settings.brand.metaKeywords ?? "",
          metaImageUrl: settings.brand.metaImageUrl ?? "",
        }}
      />
    </>
  );
}

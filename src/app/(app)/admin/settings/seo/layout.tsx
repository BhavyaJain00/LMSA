import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { Tabs } from "@/components/ui/tabs";
import { getT } from "@/i18n/server";

/** SEO settings: search appearance, indexing (sitemap, feeds, IndexNow), redirects and consent-gated tracking tags. */
export default async function SeoSettingsLayout({ children }: LayoutProps<"/admin/settings/seo">) {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/seo");
  const db = await getDb();
  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.seo.title")} description={t("pages.settings.seo.description")} />
      <Tabs
        className="mb-5"
        items={[
          { label: t("pages.settings.seo.tabs.appearance"), href: "/admin/settings/seo" },
          { label: t("pages.settings.seo.tabs.indexing"), href: "/admin/settings/seo/indexing" },
          { label: t("pages.settings.seo.tabs.redirects"), href: "/admin/settings/seo/redirects", count: db.slugRedirects.length },
          { label: t("pages.settings.seo.tabs.tracking"), href: "/admin/settings/seo/tracking" },
        ]}
      />
      {children}
    </>
  );
}

import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { Tabs } from "@/components/ui/tabs";

/** SEO settings: search appearance, indexing (sitemap, feeds, IndexNow) and redirects. */
export default async function SeoSettingsLayout({ children }: LayoutProps<"/admin/settings/seo">) {
  await requireRole(["admin"], "/admin/settings/seo");
  const db = await getDb();
  return (
    <>
      <SettingsPanelHeader title="SEO" description="How the site appears in search results, what search engines may index, and where old addresses lead." />
      <Tabs
        className="mb-5"
        items={[
          { label: "Search appearance", href: "/admin/settings/seo" },
          { label: "Indexing", href: "/admin/settings/seo/indexing" },
          { label: "Redirects", href: "/admin/settings/seo/redirects", count: db.slugRedirects.length },
        ]}
      />
      {children}
    </>
  );
}

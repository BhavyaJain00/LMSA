import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { siteOrigin } from "@/lib/seo/site";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { SeoForm } from "@/components/admin/settings/seo-form";

export const metadata = { title: "SEO settings" };

export default async function SeoSettingsPage() {
  await requireRole(["admin"], "/admin/settings/seo");
  const settings = await getSettings();
  const { brand, seo } = settings;
  return (
    <>
      <SettingsPanelHeader title="SEO" description="Page titles, descriptions, share images, structured data, search engine verification and indexing." />
      <SeoForm
        initial={{
          brandName: brand.name,
          tagline: brand.tagline,
          // Canonical URLs always use APP_URL, so the preview shows that origin rather than the request host.
          siteUrl: siteOrigin(),
          siteTitleTemplate: seo.siteTitleTemplate || `%s · ${brand.name}`,
          metaDescription: seo.defaultDescription || brand.metaDescription || "",
          metaKeywords: brand.metaKeywords ?? "",
          metaImageUrl: seo.defaultOgImageUrl || brand.metaImageUrl || "",
          twitterHandle: seo.twitterHandle ?? "",
          organizationName: seo.organizationName || brand.name,
          organizationLogoUrl: seo.organizationLogoUrl ?? "",
          sameAs: seo.sameAs,
          googleVerification: seo.googleVerification ?? "",
          bingVerification: seo.bingVerification ?? "",
          noindexSite: seo.noindexSite,
        }}
      />
    </>
  );
}

import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { siteOrigin } from "@/lib/seo/site";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { CategoriesManager } from "@/components/admin/settings/categories-manager";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.categories.metaTitle") };
}

export default async function CategoriesSettingsPage() {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/categories");
  const db = await getDb();
  const courseCounts = new Map<string, number>();
  const batchCounts = new Map<string, number>();
  for (const c of db.courses) if (c.categoryId) courseCounts.set(c.categoryId, (courseCounts.get(c.categoryId) ?? 0) + 1);
  for (const b of db.batches) if (b.categoryId) batchCounts.set(b.categoryId, (batchCounts.get(b.categoryId) ?? 0) + 1);
  const categories = [...db.categories]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      courseCount: courseCounts.get(c.id) ?? 0,
      batchCount: batchCounts.get(c.id) ?? 0,
      intro: c.intro ?? "",
      seoTitle: c.seoTitle ?? "",
      seoDescription: c.seoDescription ?? "",
    }));

  return (
    <>
      <SettingsPanelHeader title={t("pages.settings.categories.title")} description={t("pages.settings.categories.description")} />
      <CategoriesManager categories={categories} siteUrl={siteOrigin()} brandName={db.settings.brand.name} />
    </>
  );
}

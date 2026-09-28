import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { CategoriesManager } from "@/components/admin/settings/categories-manager";

export const metadata = { title: "Categories" };

export default async function CategoriesSettingsPage() {
  await requireRole(["admin"], "/admin/settings/categories");
  const db = await getDb();
  const courseCounts = new Map<string, number>();
  const batchCounts = new Map<string, number>();
  for (const c of db.courses) if (c.categoryId) courseCounts.set(c.categoryId, (courseCounts.get(c.categoryId) ?? 0) + 1);
  for (const b of db.batches) if (b.categoryId) batchCounts.set(b.categoryId, (batchCounts.get(b.categoryId) ?? 0) + 1);
  const categories = [...db.categories]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, courseCount: courseCounts.get(c.id) ?? 0, batchCount: batchCounts.get(c.id) ?? 0 }));

  return (
    <>
      <SettingsPanelHeader title="Categories" description="Group courses and batches so learners can filter the catalog." />
      <CategoriesManager categories={categories} />
    </>
  );
}

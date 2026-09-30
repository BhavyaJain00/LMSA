import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getDb, getSettings } from "@/lib/db/store";
import { getLegalPage, placeholderValues } from "@/lib/legal/pages";
import { isCoreLegalSlug, isValidLegalSlug } from "@/lib/legal/pages-shared";
import { Breadcrumbs, SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { LegalPageEditor } from "@/components/legal/legal-page-editor";

export async function generateMetadata(props: PageProps<"/admin/settings/legal/[slug]">) {
  const { slug } = await props.params;
  const page = isValidLegalSlug(slug) ? await getLegalPage(slug) : null;
  return { title: page ? `Edit ${page.title}` : "Legal page" };
}

export default async function LegalPageEditorPage(props: PageProps<"/admin/settings/legal/[slug]">) {
  const { slug } = await props.params;
  await requireRole(["admin"], `/admin/settings/legal/${slug}`);
  if (!isValidLegalSlug(slug)) notFound();
  const [page, settings, db] = await Promise.all([getLegalPage(slug), getSettings(), getDb()]);
  if (!page) notFound();
  const stored = db.legalPages.some((p) => p.slug === slug);

  return (
    <>
      <Breadcrumbs items={[{ label: "Legal pages", href: "/admin/settings/legal" }, { label: page.title }]} />
      <SettingsPanelHeader
        title={page.title}
        description="Write in Markdown. Placeholders such as {{companyName}} are filled in from the legal settings when the page is shown."
      />
      <LegalPageEditor
        key={`${page.slug}:${page.version}:${page.updatedAt}`}
        page={{ slug: page.slug, title: page.title, content: page.content, published: page.published, version: page.version, updatedAt: page.updatedAt, stored }}
        isCore={isCoreLegalSlug(page.slug)}
        placeholders={placeholderValues(settings, page)}
      />
    </>
  );
}

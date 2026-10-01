import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { getPostEditorOptions } from "@/lib/data/blog";
import { siteOrigin } from "@/lib/seo/site";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { PostEditor } from "@/components/blog/admin/post-editor";
import { PageHeader } from "@/components/ui/card";

export const metadata = { title: "New article" };

export default async function NewPostPage() {
  const viewer = await requireRole(["course_creator", "moderator"], "/admin/blog/new");
  const [settings, options] = await Promise.all([getSettings(), getPostEditorOptions(viewer)]);
  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Blog", href: "/admin/blog" }, { label: "New article" }]} />}
        title="New article"
        description="Write for the questions your future learners type into search engines, then point them to the course that goes deeper."
      />
      <PostEditor
        post={null}
        options={options}
        origin={siteOrigin()}
        titleTemplate={settings.seo.siteTitleTemplate?.includes("%s") ? settings.seo.siteTitleTemplate : `%s · ${settings.brand.name}`}
        blogEnabled={settings.seo.blogEnabled}
      />
    </div>
  );
}

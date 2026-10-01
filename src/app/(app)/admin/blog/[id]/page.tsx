import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canEditPost, getPostById, getPostEditorOptions, publishDuePosts } from "@/lib/data/blog";
import { siteOrigin } from "@/lib/seo/site";
import { effectivePostStatus } from "@/lib/seo/visibility";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { PostEditor } from "@/components/blog/admin/post-editor";
import { POST_STATUS } from "@/components/blog/admin/post-status";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/admin/blog/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const post = await getPostById(id);
  return { title: post ? `Edit: ${post.title}` : "Article not found" };
}

export default async function EditPostPage(props: PageProps<"/admin/blog/[id]">) {
  const { id } = await props.params;
  const viewer = await requireRole(["course_creator", "moderator"], `/admin/blog/${id}`);
  await publishDuePosts();
  const post = await getPostById(id);
  if (!post) notFound();
  if (!canEditPost(viewer, post)) redirect("/forbidden");
  const [settings, options] = await Promise.all([getSettings(), getPostEditorOptions(viewer)]);
  const status = effectivePostStatus(post);

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Blog", href: "/admin/blog" }, { label: post.title || "Untitled" }]} />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{post.title || "Untitled"}</span>
            <Badge tone={POST_STATUS[status].tone} dot>
              {POST_STATUS[status].label}
            </Badge>
          </span>
        }
        description={`Created ${formatDate(post.createdAt)} · last saved ${formatDate(post.updatedAt)}${status === "published" ? ` · ${post.views} ${post.views === 1 ? "view" : "views"}` : ""}`}
      />
      <PostEditor
        key={post.updatedAt}
        post={{
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content: post.content,
          coverImageUrl: post.coverImageUrl ?? "",
          categoryIds: post.categoryIds,
          tags: post.tags,
          relatedCourseIds: post.relatedCourseIds,
          faq: post.faq ?? [],
          seoTitle: post.seoTitle ?? "",
          seoDescription: post.seoDescription ?? "",
          canonicalUrl: post.canonicalUrl ?? "",
          focusKeyword: post.focusKeyword ?? "",
          noindex: !!post.noindex,
          status,
          publishedAt: post.publishedAt,
          authorId: post.authorId,
        }}
        options={options}
        origin={siteOrigin()}
        titleTemplate={settings.seo.siteTitleTemplate?.includes("%s") ? settings.seo.siteTitleTemplate : `%s · ${settings.brand.name}`}
        blogEnabled={settings.seo.blogEnabled}
      />
    </div>
  );
}

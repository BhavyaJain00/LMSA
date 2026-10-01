import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canManageCourse, getCourseById } from "@/lib/data/courses";
import { requireManageableCourse } from "@/lib/data/admin-courses";
import { hasSalesPage } from "@/lib/seo/sales-page";
import { siteOrigin } from "@/lib/seo/site";
import { SalesPageEditor } from "@/components/admin/courses/sales-page-editor";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";

export async function generateMetadata(props: PageProps<"/admin/courses/[id]/sales-page">) {
  const { id } = await props.params;
  const [course, user] = await Promise.all([getCourseById(id), getCurrentUser()]);
  if (!course || !canManageCourse(user, course)) return { title: "Sales page" };
  return { title: `Sales page · ${course.title}` };
}

/**
 * Sales page builder of a course (instructors of the course, moderators and
 * admins): hero, ordered sections, testimonials, FAQ, guarantee, countdown
 * and the page's SEO fields. The public course page renders the saved page
 * and keeps its standard layout while none is configured.
 */
export default async function CourseSalesPagePage(props: PageProps<"/admin/courses/[id]/sales-page">) {
  const { id } = await props.params;
  const { course } = await requireManageableCourse(id, `/admin/courses/${id}/sales-page`);
  const settings = await getSettings();
  const live = hasSalesPage(course.salesPage);

  return (
    <div>
      <PageHeader
        breadcrumbs={
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
            <Link href="/admin/courses" className="hover:text-ink hover:underline">
              Courses
            </Link>
            <Icon.ChevronRight className="size-3.5" aria-hidden="true" />
            <Link href={`/admin/courses/${course.id}`} className="max-w-60 truncate hover:text-ink hover:underline">
              {course.title}
            </Link>
            <Icon.ChevronRight className="size-3.5" aria-hidden="true" />
            <span className="text-ink" aria-current="page">
              Sales page
            </span>
          </nav>
        }
        title="Sales page"
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {live ? (
              <Badge tone="success" dot>
                Live on the course page
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Standard layout
              </Badge>
            )}
            {!course.published && <Badge tone="warning">Course not published</Badge>}
            <span className="text-xs text-ink-faint">/courses/{course.slug}</span>
          </span>
        }
        actions={
          <ButtonLink href={`/admin/courses/${course.id}`} variant="outline" size="sm" leftIcon={<Icon.ArrowLeft className="size-4" />}>
            Back to the course
          </ButtonLink>
        }
      />
      <SalesPageEditor
        course={{
          id: course.id,
          slug: course.slug,
          title: course.title,
          shortIntroduction: course.shortIntroduction,
          description: course.description,
          outcomes: course.outcomes,
          hasVideo: !!course.videoUrl,
          hasCertificate: course.enableCertification || course.paidCertificate,
        }}
        initial={course.salesPage ?? null}
        seo={{ seoTitle: course.seoTitle ?? "", metaDescription: course.metaDescription ?? "", ogImageUrl: course.ogImageUrl ?? "" }}
        origin={siteOrigin()}
        titleTemplate={settings.seo.siteTitleTemplate || `%s · ${settings.brand.name}`}
      />
    </div>
  );
}

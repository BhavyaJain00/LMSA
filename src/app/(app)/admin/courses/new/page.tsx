import Link from "next/link";
import { isAdmin, isModerator, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { canCreateCourses, getCourseFormOptions } from "@/lib/data/admin-courses";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { CourseForm } from "@/components/admin/courses/course-form";

export const metadata = { title: "New Course" };

export default async function NewCoursePage() {
  const user = await requireUser("/admin/courses/new");
  if (!canCreateCourses(user)) {
    return (
      <EmptyState
        icon={<Icon.Lock />}
        title="New Course"
        description="You are not permitted to create a course."
        action={
          <ButtonLink href="/courses" variant="outline">
            Browse courses
          </ButtonLink>
        }
      />
    );
  }
  const [options, db] = await Promise.all([getCourseFormOptions(), getDb()]);
  const tagSuggestions = Array.from(new Set(db.courses.flatMap((c) => c.tags))).sort((a, b) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-sm text-ink-muted">
            <Link href="/admin/courses" className="hover:text-ink hover:underline">
              Courses
            </Link>
            <Icon.ChevronRight className="size-3.5" />
            <span className="text-ink">New</span>
          </nav>
        }
        title="New Course"
        description="Start with the essentials. You can refine everything later, then build the outline and publish when it's ready."
      />
      <CourseForm
        mode="create"
        cancelHref="/admin/courses"
        options={options}
        tagSuggestions={tagSuggestions}
        canCreateMembers={isModerator(user)}
        canGrantAdmin={isAdmin(user)}
        initial={{
          title: "",
          slug: "",
          shortIntroduction: "",
          description: "",
          imageUrl: undefined,
          videoUrl: undefined,
          cardGradient: "blue",
          categoryId: undefined,
          tags: [],
          instructorIds: [user.id],
          evaluatorId: undefined,
          outcomes: [],
          requirements: [],
          relatedCourseIds: [],
        }}
      />
    </div>
  );
}

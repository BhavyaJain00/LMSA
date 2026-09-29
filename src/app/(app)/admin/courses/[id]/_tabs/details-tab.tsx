import type { Course, User } from "@/lib/types";
import { isAdmin, isModerator } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getCourseFormOptions } from "@/lib/data/admin-courses";
import { CourseForm } from "@/components/admin/courses/course-form";

export async function DetailsTab({ course, user }: { course: Course; user: User }) {
  const [options, db] = await Promise.all([getCourseFormOptions(course.id), getDb()]);
  const tagSuggestions = Array.from(new Set(db.courses.flatMap((c) => c.tags))).sort((a, b) => a.localeCompare(b));
  const reviewResetNotice = !isModerator(user) && !course.published && course.status !== "in_progress";

  return (
    <CourseForm
      key={course.updatedAt}
      mode="edit"
      courseId={course.id}
      cancelHref="/admin/courses"
      options={options}
      tagSuggestions={tagSuggestions}
      reviewResetNotice={reviewResetNotice}
      canCreateMembers={isModerator(user)}
      canGrantAdmin={isAdmin(user)}
      initial={{
        title: course.title,
        slug: course.slug,
        shortIntroduction: course.shortIntroduction,
        description: course.description,
        imageUrl: course.imageUrl,
        videoUrl: course.videoUrl,
        cardGradient: course.cardGradient,
        categoryId: course.categoryId,
        tags: course.tags,
        instructorIds: course.instructorIds,
        evaluatorId: course.evaluatorId,
        outcomes: course.outcomes,
        requirements: course.requirements,
        relatedCourseIds: course.relatedCourseIds,
      }}
    />
  );
}

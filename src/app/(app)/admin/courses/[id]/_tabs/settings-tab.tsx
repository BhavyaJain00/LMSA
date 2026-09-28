import type { Course, User } from "@/lib/types";
import { isAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { listEvaluators } from "@/lib/data/users";
import { getWorkflowFlags } from "@/lib/data/admin-courses";
import { currencies } from "@/lib/config";
import { CourseSettingsForm } from "@/components/admin/courses/course-settings-form";
import { CourseWorkflow } from "@/components/admin/courses/course-workflow";
import { DeleteCourseCard } from "@/components/admin/courses/delete-course-card";

export async function SettingsTab({ course, user }: { course: Course; user: User }) {
  const [db, evaluators] = await Promise.all([getDb(), listEvaluators()]);
  const flags = getWorkflowFlags(user, course);
  const lessonCount = db.lessons.filter((l) => l.courseId === course.id).length;
  const counts = {
    chapters: db.chapters.filter((c) => c.courseId === course.id).length,
    lessons: lessonCount,
    enrollments: db.enrollments.filter((e) => e.courseId === course.id).length,
    reviews: db.reviews.filter((r) => r.courseId === course.id).length,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <CourseSettingsForm
          key={course.updatedAt}
          courseId={course.id}
          evaluators={evaluators.filter((u) => u.enabled)}
          currencies={currencies}
          paymentsConfigured={db.settings.commerce.paymentGateway !== "none"}
          canManagePayments={isAdmin(user)}
          initial={{
            published: course.published,
            featured: course.featured,
            upcoming: course.upcoming,
            disableSelfLearning: course.disableSelfLearning,
            enforceLessonCompletion: course.enforceLessonCompletion,
            paidCourse: course.paidCourse,
            price: course.price,
            currency: course.currency,
            enableCertification: course.enableCertification,
            paidCertificate: course.paidCertificate,
            certificatePrice: course.certificatePrice,
            evaluatorId: course.evaluatorId,
          }}
        />
      </div>
      <div className="space-y-6">
        <CourseWorkflow courseId={course.id} status={course.status} published={course.published} publishedOn={course.publishedOn} flags={flags} lessonCount={lessonCount} />
        {flags.canDelete && <DeleteCourseCard courseId={course.id} title={course.title} counts={counts} />}
      </div>
    </div>
  );
}

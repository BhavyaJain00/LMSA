import Link from "next/link";
import type { Course } from "@/lib/types";
import { getCourseDashboard } from "@/lib/data/admin-courses";
import { formatNumber, formatPrice, relativeTime } from "@/lib/utils";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { ButtonLink } from "@/components/ui/button";
import { ProgressSummary } from "@/components/admin/courses/progress-summary";
import { EnrollStudentButton, LessonCompletionList, StudentsPanel } from "@/components/admin/courses/students-panel";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (i <= rating ? <Icon.StarFilled key={i} className="size-3.5 text-warning" /> : <Icon.Star key={i} className="size-3.5 text-ink-faint" />))}
    </span>
  );
}

export async function DashboardTab({ course }: { course: Course }) {
  const data = await getCourseDashboard(course);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">Enrollment, progress and feedback for learners in this course.</p>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={`/admin/courses/${course.id}/video-analytics`} variant="outline" leftIcon={<Icon.BarChart className="size-4" />}>
            Video analytics
          </ButtonLink>
          <EnrollStudentButton courseId={course.id} paidCertificate={course.paidCertificate} variant="outline" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Enrolled" value={formatNumber(data.enrollmentCount)} hint={data.students.length > data.enrollmentCount ? `+${data.students.length - data.enrollmentCount} staff/mentors` : "students"} icon={<Icon.Users className="size-4" />} />
        <StatCard label="Completion rate" value={`${data.completionRate}%`} hint={`${data.completedCount} completed`} icon={<Icon.CheckCircle className="size-4" />} />
        <StatCard label="Average progress" value={`${data.averageProgress}%`} hint={`${data.lessonCount} lessons`} icon={<Icon.TrendingUp className="size-4" />} />
        <StatCard
          label="Revenue"
          value={data.revenue > 0 ? formatPrice(data.revenue, data.currency) : formatPrice(0, data.currency, "—")}
          hint={course.paidCourse || course.paidCertificate ? `${data.paidOrders} paid ${data.paidOrders === 1 ? "order" : "orders"}` : "Free course"}
          icon={<Icon.CreditCard className="size-4" />}
        />
        <StatCard
          label="Average rating"
          value={
            data.averageRating !== null ? (
              <span className="inline-flex items-center gap-1.5">
                <Icon.StarFilled className="size-6 text-warning" />
                {data.averageRating.toFixed(1)}
              </span>
            ) : (
              "—"
            )
          }
          hint={`${data.reviewCount} ${data.reviewCount === 1 ? "review" : "reviews"}`}
          icon={<Icon.Star className="size-4" />}
        />
      </div>

      {data.students.length === 0 ? (
        <EmptyState
          icon={<Icon.Users />}
          title="No students enrolled yet"
          description="Enroll students to track their progress here."
          action={<EnrollStudentButton courseId={course.id} paidCertificate={course.paidCertificate} />}
          className="min-h-[30vh]"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <StudentsPanel courseId={course.id} students={data.students} />
          </div>
          <div className="min-w-0 space-y-6">
            {data.enrollmentCount > 0 && (
              <Card>
                <CardHeader title="Progress Summary" description={`${data.enrollmentCount} ${data.enrollmentCount === 1 ? "student" : "students"} by progress`} />
                <div className="p-5">
                  <ProgressSummary buckets={data.buckets} averageProgress={data.averageProgress} total={data.enrollmentCount} />
                </div>
              </Card>
            )}
            {data.lessonCompletion.length > 0 && <LessonCompletionList stats={data.lessonCompletion} />}
          </div>
        </div>
      )}

      <Card>
        <CardHeader
          title="Reviews"
          description={data.reviewCount ? `${data.averageRating?.toFixed(1)} course rating from ${data.reviewCount} ${data.reviewCount === 1 ? "review" : "reviews"}` : undefined}
          actions={
            <Link href={`/courses/${course.slug}#reviews`} className="text-sm font-medium text-accent hover:underline">
              View on course page
            </Link>
          }
        />
        {data.reviews.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">No reviews yet. Enrolled learners can rate the course from its page.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.reviews.map((r) => (
              <li key={r.id} className="flex gap-3 px-5 py-4">
                <Avatar name={r.user?.name ?? "Former member"} src={r.user?.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-ink">{r.user?.name ?? "Former member"}</span>
                    <Stars rating={r.rating} />
                    <span className="text-xs text-ink-faint">{relativeTime(r.createdAt)}</span>
                  </div>
                  {r.review && <p className="mt-1 text-sm text-ink-muted">{r.review}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

import { notFound } from "next/navigation";
import { getCurrentUser, toPublicUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canManageCourse, getCourseBySlug, getCourseProgress, getEnrollment } from "@/lib/data/courses";
import { LearnProvider } from "@/components/learn/learn-provider";
import { LearnTopBar } from "@/components/learn/learn-top-bar";

/**
 * Chrome of the lesson player for one course: slim top bar (brand, course
 * title, progress ring, back to course, theme toggle, account menu) and the
 * zen/theater preferences that persist while moving between lessons.
 */
export default async function CourseLearnLayout(props: LayoutProps<"/courses/[slug]/learn">) {
  const { slug } = await props.params;
  const [viewer, course, settings] = await Promise.all([getCurrentUser(), getCourseBySlug(slug), getSettings()]);
  if (!course) notFound();

  const enrollment = viewer ? await getEnrollment(viewer.id, course.id) : null;
  if (!course.published && !canManageCourse(viewer, course) && !enrollment) notFound();

  const progress = viewer && enrollment ? await getCourseProgress(viewer.id, course.id) : null;

  return (
    <LearnProvider>
      <LearnTopBar
        brand={{ name: settings.brand.name, logoUrl: settings.brand.logoUrl }}
        course={{ title: course.title, href: `/courses/${course.slug}` }}
        progress={progress ? { percent: progress.percent, completed: progress.completedLessons, total: progress.totalLessons } : null}
        user={viewer ? toPublicUser(viewer) : null}
        signupEnabled={!settings.learning.disableSignup}
      />
      {props.children}
    </LearnProvider>
  );
}

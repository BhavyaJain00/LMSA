import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageCourse, lessonHref } from "@/lib/data/courses";
import { getAssessmentOptions, getLessonEditorNav, getLessonPosition, getLessonVideoStats, requireManageableCourse } from "@/lib/data/admin-courses";
import { Icon } from "@/components/ui/icons";
import { LessonEditor } from "@/components/admin/courses/lesson-editor";

export async function generateMetadata(props: PageProps<"/admin/courses/[id]/lessons/[lessonId]">) {
  const { id, lessonId } = await props.params;
  const [db, user] = await Promise.all([getDb(), getCurrentUser()]);
  const lesson = db.lessons.find((l) => l.id === lessonId && l.courseId === id);
  const course = db.courses.find((c) => c.id === id);
  if (!lesson || !course) return { title: "Lesson not found" };
  return { title: canManageCourse(user, course) ? `Edit: ${lesson.title}` : "Edit lesson" };
}

export default async function LessonEditorPage(props: PageProps<"/admin/courses/[id]/lessons/[lessonId]">) {
  const { id, lessonId } = await props.params;
  const { course } = await requireManageableCourse(id, `/admin/courses/${id}/lessons/${lessonId}`);
  const db = await getDb();
  const lesson = db.lessons.find((l) => l.id === lessonId && l.courseId === course.id);
  if (!lesson) notFound();

  const [nav, position, assessments, videoStats] = await Promise.all([getLessonEditorNav(course), getLessonPosition(lesson), getAssessmentOptions(), getLessonVideoStats(lesson)]);
  const flat = nav.flatMap((c) => c.lessons);
  const i = flat.findIndex((l) => l.id === lesson.id);
  const chapter = db.chapters.find((c) => c.id === lesson.chapterId);
  const outlineHref = `/admin/courses/${course.id}?tab=outline`;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
        <Link href="/admin/courses" className="shrink-0 hover:text-ink hover:underline">
          Courses
        </Link>
        <Icon.ChevronRight className="size-3.5 shrink-0" />
        <Link href={outlineHref} className="truncate hover:text-ink hover:underline">
          {course.title}
        </Link>
        <Icon.ChevronRight className="size-3.5 shrink-0" />
        <span className="truncate text-ink">{lesson.title}</span>
      </nav>
      <LessonEditor
        key={lesson.id}
        courseId={course.id}
        lesson={{
          id: lesson.id,
          title: lesson.title,
          slug: lesson.slug,
          includeInPreview: lesson.includeInPreview,
          instructorNotes: lesson.instructorNotes ?? "",
          blocks: lesson.blocks,
          updatedAt: lesson.updatedAt,
        }}
        index={position ? `${position.chapterNumber}.${position.lessonNumber}` : "—"}
        chapterTitle={chapter?.title ?? ""}
        learnHref={position ? lessonHref(course.slug, position) : null}
        outlineHref={outlineHref}
        prevHref={i > 0 ? flat[i - 1]!.editHref : null}
        nextHref={i >= 0 && i < flat.length - 1 ? flat[i + 1]!.editHref : null}
        nav={nav}
        assessments={assessments}
        videoStats={videoStats}
      />
    </div>
  );
}

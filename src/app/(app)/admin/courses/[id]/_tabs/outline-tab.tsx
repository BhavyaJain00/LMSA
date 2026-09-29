import type { Course } from "@/lib/types";
import { getAdminOutline } from "@/lib/data/admin-courses";
import { OutlineEditor } from "@/components/admin/courses/outline-editor";
import { Icon } from "@/components/ui/icons";

export async function OutlineTab({ course }: { course: Course }) {
  const chapters = await getAdminOutline(course);
  const firstLesson = chapters.flatMap((c) => c.lessons)[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-2/50 px-4 py-3 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2">
          <Icon.Info className="mt-0.5 size-4 shrink-0" />
          <span>
            Lessons marked <strong className="font-medium text-ink">Preview</strong> can be opened without enrolling.
            {course.enforceLessonCompletion && " Lesson order matters: this course unlocks lessons one at a time."}
          </span>
        </p>
        {firstLesson && (
          <a href={firstLesson.learnHref} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1.5 font-medium text-accent hover:underline">
            <Icon.Eye className="size-4" /> Preview as student
          </a>
        )}
      </div>
      <OutlineEditor courseId={course.id} chapters={chapters} enforceOrder={course.enforceLessonCompletion} />
    </div>
  );
}

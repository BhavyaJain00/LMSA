import type { Course } from "@/lib/types";
import { buildCourseExport, summarizeExport } from "@/lib/data/admin-courses";
import { formatBytes } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export async function ExportTab({ course }: { course: Course }) {
  const file = await buildCourseExport(course);
  const summary = summarizeExport(file);
  const size = Buffer.byteLength(JSON.stringify(file, null, 2), "utf8");
  const items: [string, number][] = [
    ["Chapters", summary.chapters],
    ["Lessons", summary.lessons],
    ["Content blocks", summary.blocks],
    ["Quizzes", summary.quizzes],
    ["Questions", summary.questions],
    ["Assignments", summary.assignments],
    ["Exercises", summary.exercises],
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Export as JSON" description="Download a portable copy of this course to back it up or move it to another workspace." />
        <CardBody className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {items.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <ul className="space-y-1.5 text-sm text-ink-muted">
            <li className="flex items-start gap-2">
              <Icon.Check className="mt-0.5 size-4 shrink-0 text-success" /> Course details, outline and every lesson block
            </li>
            <li className="flex items-start gap-2">
              <Icon.Check className="mt-0.5 size-4 shrink-0 text-success" /> Quizzes with their questions, assignments and programming exercises used by the course
            </li>
            <li className="flex items-start gap-2">
              <Icon.X className="mt-0.5 size-4 shrink-0 text-ink-faint" /> No learner data: enrollments, progress, submissions and reviews stay here
            </li>
            {summary.uploads > 0 && (
              <li className="flex items-start gap-2">
                <Icon.Info className="mt-0.5 size-4 shrink-0 text-info" />
                {summary.uploads} uploaded {summary.uploads === 1 ? "file is" : "files are"} referenced by URL (/uploads/…). Copy the storage folder along if you move to another server.
              </li>
            )}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`/admin/courses/${course.id}/export`}
              download={`${course.slug}.json`}
              className="inline-flex h-9.5 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg shadow-sm hover:brightness-110"
            >
              <Icon.Download className="size-4" /> Download JSON
            </a>
            <span className="text-xs text-ink-muted">
              {course.slug}.json · about {formatBytes(size)}
            </span>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Import a course" description="Create a new course from an export file. The import gets fresh ids and starts unpublished." />
        <CardBody className="space-y-4 text-sm text-ink-muted">
          <p>Use this to duplicate a course as a starting point, restore a backup, or bring a course over from another workspace running this platform.</p>
          <ButtonLink href="/admin/courses/import" variant="outline" leftIcon={<Icon.Upload className="size-4" />}>
            Import from JSON
          </ButtonLink>
        </CardBody>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { canCreateCourses } from "@/lib/data/admin-courses";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ImportCourseForm } from "@/components/admin/courses/import-form";

export const metadata = { title: "Import Course" };

export default async function ImportCoursePage() {
  const user = await requireUser("/admin/courses/import");
  if (!canCreateCourses(user)) {
    return (
      <EmptyState
        icon={<Icon.Lock />}
        title="Import Course"
        description="You are not permitted to create a course."
        action={
          <ButtonLink href="/courses" variant="outline">
            Browse courses
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumbs={
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-sm text-ink-muted">
            <Link href="/admin/courses" className="hover:text-ink hover:underline">
              Courses
            </Link>
            <Icon.ChevronRight className="size-3.5" />
            <span className="text-ink">Import</span>
          </nav>
        }
        title="Import Course from JSON"
        description="Create a copy of a course from a JSON export, including its chapters, lessons, quizzes, assignments and exercises."
      />
      <Card>
        <CardBody>
          <ImportCourseForm />
        </CardBody>
      </Card>
      <div className="mt-6 rounded-card border border-border bg-surface-2/50 p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">Good to know</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Uploaded media (videos, images, PDFs) are referenced by URL. Files stored on another platform must be reachable from this one.</li>
          <li>Instructors, categories and related courses are kept when they exist here; otherwise you become the instructor.</li>
          <li>Learner data (enrollments, progress, reviews) is never part of an export.</li>
        </ul>
      </div>
    </div>
  );
}

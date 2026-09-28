import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canManageAssessments, getCourseOptions } from "@/lib/data/assessments";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { AssignmentForm } from "@/components/assessments/assignment-form";
import { param } from "@/components/assessments/shared";

export const metadata: Metadata = { title: "Create an Assignment" };

export default async function NewAssignmentPage(props: PageProps<"/admin/assignments/new">) {
  const user = await requireUser("/admin/assignments/new");
  if (!canManageAssessments(user)) redirect("/courses");
  const sp = await props.searchParams;
  const courseOptions = await getCourseOptions(user);
  const course = param(sp.course);

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Assignments", href: "/admin/assignments" }, { label: "New" }]} />}
        title="Create an Assignment"
        description="Write the question, choose how learners submit, and optionally set a submission window."
      />
      <AssignmentForm assignment={null} courseOptions={courseOptions} defaultCourseId={course && courseOptions.some((o) => o.value === course) ? course : undefined} />
    </div>
  );
}

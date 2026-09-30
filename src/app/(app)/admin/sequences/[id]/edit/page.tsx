import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { segmentCourseOptions } from "@/lib/comms/audience";
import { sequenceGoal } from "@/lib/comms/sequence-core";
import { getSequenceReport } from "@/lib/comms/sequences";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { SequenceForm } from "@/components/comms/sequence-form";

export const metadata = { title: "Edit sequence" };

export default async function EditSequencePage(props: PageProps<"/admin/sequences/[id]/edit">) {
  const { id } = await props.params;
  await requireRole(["moderator"], `/admin/sequences/${id}/edit`);
  const [report, courses] = await Promise.all([getSequenceReport(id), segmentCourseOptions()]);
  if (!report) notFound();
  const { sequence } = report;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit sequence"
        description={sequence.active ? "This sequence is switched on: changes apply to the next emails that go out." : "This sequence is switched off. Nothing is sent until you switch it on."}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: "Sequences", href: "/admin/sequences" },
              { label: sequence.name, href: `/admin/sequences/${sequence.id}` },
              { label: "Edit" },
            ]}
          />
        }
      />
      <SequenceForm
        courses={courses}
        activePeople={report.summary.active}
        initial={{
          id: sequence.id,
          name: sequence.name,
          description: sequence.description,
          trigger: sequence.trigger,
          // A course that was deleted since falls back to "any course" (the server would refuse it).
          courseId: sequence.courseId && courses.some((c) => c.id === sequence.courseId) ? sequence.courseId : undefined,
          inactiveDays: sequence.inactiveDays,
          goal: sequenceGoal(sequence),
          steps: sequence.steps.map((step) => ({ id: step.id, delayHours: step.delayHours, subject: step.subject, body: step.body })),
        }}
      />
    </div>
  );
}

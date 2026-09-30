import { requireRole } from "@/lib/auth/session";
import { segmentCourseOptions } from "@/lib/comms/audience";
import { defaultGoal, findSequenceTemplate } from "@/lib/comms/sequence-core";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { SequenceForm, type SequenceFormValues } from "@/components/comms/sequence-form";
import { SequenceTemplates } from "@/components/comms/sequence-templates";

export const metadata = { title: "New sequence" };

const BLANK: SequenceFormValues = {
  name: "",
  trigger: "signup",
  goal: defaultGoal("signup"),
  steps: [{ delayHours: 0, subject: "", body: "" }],
};

export default async function NewSequencePage(props: PageProps<"/admin/sequences/new">) {
  await requireRole(["moderator"], "/admin/sequences/new");
  const [courses, searchParams] = await Promise.all([segmentCourseOptions(), props.searchParams]);
  const key = Array.isArray(searchParams.template) ? searchParams.template[0] : searchParams.template;
  const template = findSequenceTemplate(key);
  const initial: SequenceFormValues = template ? { ...template.draft, steps: template.draft.steps.map((step) => ({ ...step })) } : BLANK;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="New sequence"
        description="Choose what starts the sequence, what ends it early, and write the emails. It is saved switched off unless you choose otherwise."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Broadcasts", href: "/admin/broadcasts" },
              { label: "Sequences", href: "/admin/sequences" },
              { label: "New sequence" },
            ]}
          />
        }
      />
      <section aria-labelledby="sequence-templates" className="mb-6">
        <h2 id="sequence-templates" className="mb-2 text-sm font-medium text-ink">
          {template ? "Started from a template — pick another one to replace the form below" : "Start from a template (optional)"}
        </h2>
        <SequenceTemplates current={template?.key} />
      </section>
      {/* The key resets the form when another template is picked. */}
      <SequenceForm key={template?.key ?? "blank"} courses={courses} initial={initial} />
    </div>
  );
}

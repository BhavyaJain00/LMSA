import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { canEditRubric, canUseRubrics, getRubric, getRubricUsage } from "@/lib/teaching/rubrics";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { LocalDateTime } from "@/components/assessments/client-time";
import { RubricEditor } from "@/components/teaching/rubric-editor";
import { DeleteRubricButton, DuplicateRubricButton } from "@/components/teaching/rubrics-table";

export async function generateMetadata(props: PageProps<"/admin/rubrics/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const rubric = await getRubric(id);
  return { title: rubric ? `Rubric: ${rubric.title}` : "Rubric" };
}

export default async function RubricPage(props: PageProps<"/admin/rubrics/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/admin/rubrics/${id}`);
  if (!canUseRubrics(user)) redirect("/courses");
  const rubric = await getRubric(id);
  if (!rubric) notFound();

  const [usage, db] = await Promise.all([getRubricUsage(rubric.id), getDb()]);
  const editable = canEditRubric(user, rubric);
  const author = db.users.find((u) => u.id === rubric.createdById);

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Rubrics", href: "/admin/rubrics" }, { label: rubric.title }]} />}
        title={editable ? "Edit rubric" : rubric.title}
        description={
          <>
            Created by {author?.id === user.id ? "you" : (author?.name ?? "a deleted user")} · last saved <LocalDateTime iso={rubric.updatedAt} />
          </>
        }
        actions={
          <>
            <DuplicateRubricButton id={rubric.id} title={rubric.title} variant="button" />
            {editable && <DeleteRubricButton id={rubric.id} inUse={usage.assignments.length} />}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <RubricEditor
            canEdit={editable}
            gradedCount={usage.gradedSubmissions}
            initial={{ id: rubric.id, title: rubric.title, passPercent: rubric.passPercent, criteria: rubric.criteria }}
          />
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title="Used by" description="Assignments graded with this rubric." />
            <CardBody>
              {usage.assignments.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Not attached to any assignment yet. Open an assignment and pick this rubric under <span className="font-medium text-ink">Rubric &amp; peer review</span>.
                </p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {usage.assignments.map((a) => (
                    <li key={a.id} className="flex items-start gap-2">
                      <Icon.ClipboardList className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                      <div className="min-w-0">
                        <Link href={`/admin/assignments/${a.id}`} className="font-medium text-ink hover:underline">
                          {a.title}
                        </Link>
                        <p className="text-xs text-ink-muted">
                          {a.courseTitle ?? "No course"} · {a.graded} of {a.submissions} scored
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {usage.peerReviews > 0 && (
                <p className="mt-4 border-t border-border pt-3 text-xs text-ink-muted">
                  {usage.peerReviews} peer {usage.peerReviews === 1 ? "review has" : "reviews have"} been scored with it.
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Tips" />
            <CardBody className="space-y-2 text-sm text-ink-muted">
              <p>Describe observable work at each level so two graders would pick the same one.</p>
              <p>Each criterion is worth the points of its best level; the pass mark is a percentage of the total.</p>
              <p>Learners see the rubric before they submit, so they know how their work is judged.</p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

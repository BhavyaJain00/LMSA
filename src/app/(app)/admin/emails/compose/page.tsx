import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { batchAudienceValues } from "@/lib/email/batch";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { BatchEmailComposer, type ComposerBatch } from "@/components/admin/emails/batch-email-composer";

export const metadata = { title: "Send a batch email" };

export default async function ComposeBatchEmailPage(props: PageProps<"/admin/emails/compose">) {
  await requireRole(["moderator"], "/admin/emails/compose");
  const sp = await props.searchParams;
  const initialBatchId = typeof sp.batch === "string" ? sp.batch : undefined;
  const db = await getDb();

  const batches: ComposerBatch[] = db.batches
    .slice()
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((batch) => {
      const studentIds = new Set(db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId));
      return {
        id: batch.id,
        title: batch.title,
        students: db.users
          .filter((u) => studentIds.has(u.id))
          .map((u) => ({ id: u.id, name: u.name, email: u.email }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        templates: db.emailTemplates
          .filter((t) => t.batchId === batch.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body })),
        values: batchAudienceValues(db, batch),
      };
    });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Send a batch email"
        description="Email the students of a batch from one of its templates or with a new message. Placeholders such as {{ member_name }} are filled for each student."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Outbox", href: "/admin/emails" },
              { label: "Send a batch email" },
            ]}
          />
        }
      />
      <BatchEmailComposer batches={batches} initialBatchId={initialBatchId} />
    </div>
  );
}

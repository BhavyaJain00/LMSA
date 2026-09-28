import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canIssueCertificates, getBulkIssueRoster, getCertificateFormOptions, listBatchesForBulkIssue } from "@/lib/data/certificates";
import { Card, PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { param } from "@/components/assessments/shared";
import { BulkIssueForm } from "@/components/certificates/bulk-issue-form";
import { formatShortDate } from "@/components/certificates/time";
import { toDateKey } from "@/lib/utils";

export const metadata: Metadata = { title: "Generate Certificates" };

export default async function BulkCertificatesPage(props: PageProps<"/admin/certificates/bulk">) {
  const user = await requireUser("/admin/certificates/bulk");
  if (!canIssueCertificates(user)) redirect("/forbidden");
  const sp = await props.searchParams;
  const batchId = param(sp.batch);

  if (!batchId) {
    const batches = await listBatchesForBulkIssue();
    return (
      <div className="animate-fade-in">
        <PageHeader
          breadcrumbs={<Breadcrumbs items={[{ label: "Certificates", href: "/admin/certificates" }, { label: "Bulk issue" }]} />}
          title="Generate Certificates"
          description="Pick a batch to certify its students in one go."
        />
        {batches.length === 0 ? (
          <EmptyState
            icon={<Icon.Users />}
            title="No batches yet"
            description="Create a batch with certification enabled, enroll students, then come back to issue their certificates."
            action={<ButtonLink href="/admin/batches">Manage batches</ButtonLink>}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {batches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/certificates/bulk?batch=${b.id}`}
                  className="flex h-full flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card transition-colors hover:border-border-strong hover:bg-surface-2/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-ink">{b.title}</p>
                    {b.certification ? <Badge tone="success">Certification on</Badge> : <Badge tone="neutral">Certification off</Badge>}
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted">
                    <Icon.Calendar className="size-4" />
                    {formatShortDate(b.startDate)} – {formatShortDate(b.endDate)}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
                    <Icon.Users className="size-4" />
                    {b.studentCount} student{b.studentCount === 1 ? "" : "s"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const [roster, options] = await Promise.all([getBulkIssueRoster(batchId), getCertificateFormOptions()]);
  if (!roster) notFound();

  const header = (
    <PageHeader
      breadcrumbs={
        <Breadcrumbs
          items={[
            { label: "Certificates", href: "/admin/certificates" },
            { label: "Bulk issue", href: "/admin/certificates/bulk" },
            { label: roster.batch.title },
          ]}
        />
      }
      title="Generate Certificates"
      description={roster.batch.title}
      actions={
        <ButtonLink href={`/batches/${roster.batch.slug}`} variant="outline" leftIcon={<Icon.Users className="size-4" />}>
          View batch
        </ButtonLink>
      }
    />
  );

  if (!roster.batch.certification) {
    return (
      <div className="animate-fade-in">
        {header}
        <EmptyState
          icon={<Icon.Certificate />}
          title="Certificates are not enabled for this batch."
          description="Turn on certification in the batch settings, then generate certificates here."
          action={<ButtonLink href={`/admin/batches/${roster.batch.id}`}>Open batch settings</ButtonLink>}
        />
      </div>
    );
  }
  if (roster.students.length === 0) {
    return (
      <div className="animate-fade-in">
        {header}
        <EmptyState icon={<Icon.Users />} title="This batch has no students to certify." description="Students appear here once they enroll in the batch." />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {header}
      <Card className="mb-6 flex items-start gap-3 border-info/30 bg-info/5 p-4 text-sm text-ink-muted">
        <Icon.Info className="mt-0.5 size-4 shrink-0 text-info" />
        Students who already hold the selected certificate are skipped. Each learner is notified and can share their verification link.
      </Card>
      <BulkIssueForm roster={roster} evaluators={options.evaluators} today={toDateKey()} />
    </div>
  );
}

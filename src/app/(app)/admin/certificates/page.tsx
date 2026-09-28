import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/store";
import { canIssueCertificates, getCertificateFormOptions, listCertificates, type CertificateStatusFilter } from "@/lib/data/certificates";
import { PageHeader, StatCard } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { FilterBar, ListFooter } from "@/components/assessments/list-controls";
import { param, parsePaging } from "@/components/assessments/shared";
import { CertificatesTable } from "@/components/certificates/certificates-table";
import { toDateKey } from "@/lib/utils";

export const metadata: Metadata = { title: "Certificates" };

const STATUSES: CertificateStatusFilter[] = ["published", "unpublished", "expired"];

export default async function AdminCertificatesPage(props: PageProps<"/admin/certificates">) {
  const user = await requireUser("/admin/certificates");
  if (!canIssueCertificates(user)) redirect("/forbidden");
  const sp = await props.searchParams;
  const search = param(sp.search);
  const courseId = param(sp.course);
  const batchId = param(sp.batch);
  const rawStatus = param(sp.status) as CertificateStatusFilter | undefined;
  const status = rawStatus && STATUSES.includes(rawStatus) ? rawStatus : "";
  const { size, pages, limit } = parsePaging(sp.size, sp.pages);

  const [rows, all, options, settings] = await Promise.all([
    listCertificates({ search, courseId, batchId, status }),
    listCertificates(),
    getCertificateFormOptions(),
    getSettings(),
  ]);
  const shown = rows.slice(0, limit);
  const filtered = !!(search || courseId || batchId || status);
  const monthPrefix = toDateKey().slice(0, 7);
  const thisMonth = all.filter((c) => c.issueDate.startsWith(monthPrefix)).length;
  const learners = new Set(all.map((c) => c.user.id)).size;

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Certificates" }]} />}
        title={`${rows.length} ${rows.length === 1 ? "Certificate" : "Certificates"}`}
        description="Issue, publish and revoke certificates. Each one has a public verification page."
        actions={
          <>
            <ButtonLink href={batchId ? `/admin/certificates/bulk?batch=${batchId}` : "/admin/certificates/bulk"} variant="outline" leftIcon={<Icon.Users className="size-4" />}>
              Bulk issue
            </ButtonLink>
            <ButtonLink href="/admin/certificates/new" leftIcon={<Icon.Plus className="size-4" />}>
              Issue certificate
            </ButtonLink>
          </>
        }
      />
      {!settings.features.certifications && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Certifications are turned off in Settings → Features. Existing certificates still verify, but learners can&apos;t earn new ones automatically.
        </p>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Certificates issued" value={all.length} icon={<Icon.Certificate className="size-5" />} />
        <StatCard label="Issued this month" value={thisMonth} icon={<Icon.Calendar className="size-5" />} />
        <StatCard label="Certified learners" value={learners} icon={<Icon.Award className="size-5" />} />
      </div>
      <FilterBar
        filters={[
          { param: "search", kind: "search", label: "Search", placeholder: "Search learner, email or ID" },
          { param: "course", kind: "select", label: "Course", placeholder: "All courses", options: options.courses },
          { param: "batch", kind: "select", label: "Batch", placeholder: "All batches", options: options.batches.map((b) => ({ value: b.value, label: b.label })) },
          {
            param: "status",
            kind: "select",
            label: "Status",
            placeholder: "Any status",
            options: [
              { value: "published", label: "Published" },
              { value: "unpublished", label: "Unpublished" },
              { value: "expired", label: "Expired" },
            ],
          },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon.Certificate />}
          title={filtered ? "No certificates match these filters" : "No certificates issued yet"}
          description={
            filtered
              ? "Try clearing the filters to see every certificate."
              : "Certificates appear here when learners complete certificate courses, pass evaluations, or when you issue them manually."
          }
          action={
            <ButtonLink href="/admin/certificates/new" leftIcon={<Icon.Plus className="size-4" />}>
              Issue certificate
            </ButtonLink>
          }
        />
      ) : (
        <>
          <CertificatesTable rows={shown} />
          <ListFooter shown={shown.length} total={rows.length} size={size} pages={pages} noun="certificates" />
        </>
      )}
    </div>
  );
}

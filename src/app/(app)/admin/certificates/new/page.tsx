import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { canIssueCertificates, getCertificateFormOptions } from "@/lib/data/certificates";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/assessments/breadcrumbs";
import { param } from "@/components/assessments/shared";
import { IssueCertificateForm } from "@/components/certificates/issue-certificate-form";
import { toDateKey } from "@/lib/utils";

export const metadata: Metadata = { title: "Issue certificate" };

export default async function IssueCertificatePage(props: PageProps<"/admin/certificates/new">) {
  const user = await requireUser("/admin/certificates/new");
  if (!canIssueCertificates(user)) redirect("/forbidden");
  const sp = await props.searchParams;
  const options = await getCertificateFormOptions();

  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Certificates", href: "/admin/certificates" }, { label: "Issue" }]} />}
        title="Issue certificate"
        description="Manually certify a learner for a course or a batch."
      />
      <IssueCertificateForm options={options} today={toDateKey()} defaults={{ userId: param(sp.user), courseId: param(sp.course), batchId: param(sp.batch) }} />
    </div>
  );
}

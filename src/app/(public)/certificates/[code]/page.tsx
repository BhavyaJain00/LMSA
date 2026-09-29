import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth/session";
import { getCertificateByCode, getCertificateUrl, type CertificateDetail } from "@/lib/data/certificates";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { CertificateSheet } from "@/components/certificates/certificate-sheet";
import { CertificateActions } from "@/components/certificates/certificate-actions";
import { formatLongDate } from "@/components/certificates/time";

/** Route params are already URL-decoded; decoding again throws on a literal "%" (e.g. /certificates/100%25). */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function loadVisible(code: string): Promise<{ detail: CertificateDetail; owner: boolean; staff: boolean } | null> {
  const decoded = safeDecode(code);
  const detail = (await getCertificateByCode(code)) ?? (decoded !== code ? await getCertificateByCode(decoded) : null);
  if (!detail) return null;
  const viewer = await getCurrentUser();
  const owner = !!viewer && viewer.id === detail.certificate.userId;
  const staff = isStaff(viewer);
  if (!detail.certificate.published && !owner && !staff) return null;
  return { detail, owner, staff };
}

export async function generateMetadata(props: PageProps<"/certificates/[code]">): Promise<Metadata> {
  const { code } = await props.params;
  const loaded = await loadVisible(code);
  if (!loaded) return { title: "Certificate not found", robots: { index: false } };
  const { detail } = loaded;
  const title = detail.course?.title ?? detail.batch?.title ?? "Certificate";
  const name = detail.learner?.name ?? "Learner";
  const description = `${name} earned a certificate for ${title} from ${detail.brand.name} on ${formatLongDate(detail.certificate.issueDate)}.`;
  const url = await getCertificateUrl(detail.certificate.code);
  return {
    title: `${name} · ${title}`,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${name} · ${title}`, description, url, type: "website", siteName: detail.brand.name },
    robots: detail.certificate.published ? undefined : { index: false },
  };
}

export default async function CertificatePage(props: PageProps<"/certificates/[code]">) {
  const { code } = await props.params;
  const loaded = await loadVisible(code);
  if (!loaded) notFound();
  const { detail, owner, staff } = loaded;
  const { certificate, learner, course, batch, evaluator, instructors, brand, expired } = detail;

  const title = course?.title ?? batch?.title ?? "Course";
  const learnerName = learner?.name ?? "Former member";
  // Absolute links come from APP_URL when it is set (see getPublicBaseUrl), otherwise from the request.
  const verifyUrl = await getCertificateUrl(certificate.code);
  const displayUrl = verifyUrl.replace(/^https?:\/\//, "");
  const issueYear = certificate.issueDate.slice(0, 4);
  const issueMonth = String(Number(certificate.issueDate.slice(5, 7)));
  const linkedIn = `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(title)}&organizationName=${encodeURIComponent(brand.name)}&issueYear=${issueYear}&issueMonth=${issueMonth}&certUrl=${encodeURIComponent(verifyUrl)}&certId=${encodeURIComponent(certificate.code)}`;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Verification banner */}
      <div className="public-chrome flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={
              expired
                ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning"
                : "flex size-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
            }
          >
            {expired ? <Icon.AlertTriangle className="size-5" /> : <Icon.ShieldCheck className="size-5" />}
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
              {expired ? "This certificate has expired" : "Verified certificate"}
              {!certificate.published && <Badge tone="info">Unpublished · visible to you{staff && !owner ? " and staff" : ""}</Badge>}
            </p>
            <p className="text-sm text-ink-muted">
              Issued by {brand.name} to {learnerName} on {formatLongDate(certificate.issueDate)}
              {certificate.expiryDate ? (expired ? ` · expired ${formatLongDate(certificate.expiryDate)}` : ` · valid until ${formatLongDate(certificate.expiryDate)}`) : ""}.
            </p>
          </div>
        </div>
        <CertificateActions url={verifyUrl} title={`${learnerName} · ${title}`} className="shrink-0" />
      </div>

      <CertificateSheet
        brandName={brand.name}
        logoUrl={brand.logoUrl}
        learnerName={learnerName}
        title={title}
        kind={course ? "course" : "batch"}
        issueDate={certificate.issueDate}
        expiryDate={certificate.expiryDate}
        evaluatorName={evaluator?.name}
        instructorNames={instructors.map((i) => i.name)}
        code={certificate.code}
        verifyUrl={displayUrl}
        templateId={certificate.templateId}
      />

      {/* Details (screen only) */}
      <section className="public-chrome grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]" aria-label="Certificate details">
        <div className="rounded-card border border-border bg-surface-1 p-5 shadow-card">
          <h2 className="mb-4 text-base font-semibold text-ink">Certificate details</h2>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">Recipient</dt>
              <dd className="mt-1 flex items-center gap-2">
                {learner ? (
                  <>
                    <Avatar name={learner.name} src={learner.avatarUrl} size="xs" />
                    <Link href={`/user/${learner.username}`} className="font-medium text-ink hover:underline">
                      {learner.name}
                    </Link>
                  </>
                ) : (
                  <span className="font-medium text-ink">{learnerName}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">{course ? "Course" : "Batch"}</dt>
              <dd className="mt-1">
                {course ? (
                  <Link href={`/courses/${course.slug}`} className="font-medium text-accent hover:underline">
                    {course.title}
                  </Link>
                ) : batch ? (
                  <Link href={`/batches/${batch.slug}`} className="font-medium text-accent hover:underline">
                    {batch.title}
                  </Link>
                ) : (
                  <span className="text-ink">No longer available</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Issued on</dt>
              <dd className="mt-1 font-medium text-ink">{formatLongDate(certificate.issueDate)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Expires</dt>
              <dd className="mt-1 font-medium text-ink">{certificate.expiryDate ? formatLongDate(certificate.expiryDate) : "Never"}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{evaluator ? "Evaluated by" : instructors.length > 1 ? "Instructors" : "Instructor"}</dt>
              <dd className="mt-1 font-medium text-ink">{evaluator ? evaluator.name : instructors.length ? instructors.map((i) => i.name).join(", ") : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Certificate ID</dt>
              <dd className="mt-1 font-mono font-medium text-ink">{certificate.code}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-ink-muted">Verification URL</dt>
              <dd className="mt-1 break-all">
                <a href={verifyUrl} className="font-medium text-accent hover:underline">
                  {verifyUrl}
                </a>
              </dd>
            </div>
          </dl>
        </div>
        <div className="space-y-3 rounded-card border border-border bg-surface-1 p-5 shadow-card">
          <h2 className="text-base font-semibold text-ink">Share this achievement</h2>
          <p className="text-sm text-ink-muted">Anyone with this link can verify the certificate. Use “Print / Save as PDF” and choose “Save as PDF” as the destination for a file copy.</p>
          {owner && certificate.published && (
            <ButtonLink href={linkedIn} variant="outline" className="w-full" leftIcon={<Icon.Briefcase className="size-4" />}>
              Add to LinkedIn profile
            </ButtonLink>
          )}
          {course && (
            <ButtonLink href={`/courses/${course.slug}`} variant="ghost" className="w-full" leftIcon={<Icon.BookOpen className="size-4" />}>
              View the course
            </ButtonLink>
          )}
          {staff && (
            <ButtonLink href="/admin/certificates" variant="ghost" className="w-full" leftIcon={<Icon.Certificate className="size-4" />}>
              Manage certificates
            </ButtonLink>
          )}
        </div>
      </section>
    </div>
  );
}

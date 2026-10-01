"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Batch, Certificate, Course, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { canIssueCertificates, isEvaluatorRole } from "@/lib/data/certificates";
import { issueCertificate } from "@/lib/services/progress";
import { notify } from "@/lib/services/notifications";
import { evaluateBadges } from "@/lib/services/badges";
import { awardCertificatePoints, revokeCertificatePoints } from "@/lib/services/points";
import { setFlash } from "@/lib/flash";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/events";
import { fd, fdBool, shortCode, toDateKey, uid } from "@/lib/utils";
import { isValidDateKey } from "@/components/certificates/time";
import { DEFAULT_CERTIFICATE_TEMPLATE_ID, isCertificateTemplateId } from "@/components/certificates/templates";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface IssueOptions {
  issueDate: string;
  expiryDate?: string;
  evaluatorId?: string;
  published: boolean;
  batchId?: string;
  /** Registered certificate template id (templates.ts). */
  templateId: string;
  /** Who issues it (no points when a staff member issues their own certificate). */
  issuedById?: string;
}

function revalidateCertificates(extra: string[] = []) {
  revalidatePath("/admin/certificates");
  revalidatePath("/certified-members");
  revalidatePath("/dashboard");
  for (const p of extra) revalidatePath(p);
}

function parseDates(issueRaw: string, expiryRaw: string): { issueDate?: string; expiryDate?: string; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const issueDate = issueRaw || toDateKey();
  if (!isValidDateKey(issueDate)) errors.issueDate = "Enter a valid issue date.";
  let expiryDate: string | undefined;
  if (expiryRaw) {
    if (!isValidDateKey(expiryRaw)) errors.expiryDate = "Enter a valid expiry date.";
    else if (expiryRaw <= issueDate) errors.expiryDate = "Expiry date must be after the issue date.";
    else expiryDate = expiryRaw;
  }
  return { issueDate, expiryDate, errors };
}

/** The submitted "Template" value: empty → the default template; unknown ids are rejected. */
function parseTemplate(raw: string, errors: Record<string, string>): string {
  if (!raw) return DEFAULT_CERTIFICATE_TEMPLATE_ID;
  if (!isCertificateTemplateId(raw)) {
    errors.templateId = "Choose one of the available certificate templates.";
    return DEFAULT_CERTIFICATE_TEMPLATE_ID;
  }
  return raw;
}

/** Why a learner cannot receive a course certificate, or null when they can. */
async function courseCertificateBlocker(learner: User, course: Course, opts: { allowIncomplete: boolean }): Promise<string | null> {
  const db = await getDb();
  if (db.certificates.some((c) => c.userId === learner.id && c.courseId === course.id)) {
    return `${learner.name} is already certified for the course ${course.title}`;
  }
  const enrollment = db.enrollments.find((e) => e.userId === learner.id && e.courseId === course.id);
  if (!enrollment) return "Certification cannot be issued as the member is not enrolled in this course.";
  if (course.enableCertification && !course.paidCertificate && enrollment.progress < 100 && !opts.allowIncomplete) {
    return "Certification cannot be issued as the member has not completed the course.";
  }
  return null;
}

async function batchCertificateBlocker(learner: User, batch: Batch): Promise<string | null> {
  const db = await getDb();
  if (!db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === learner.id)) {
    return "Certification cannot be issued as the member is not enrolled in this batch.";
  }
  if (db.certificates.some((c) => c.userId === learner.id && c.batchId === batch.id && !c.courseId)) {
    return `${learner.name} is already certified for the batch ${batch.title}`;
  }
  return null;
}

/** Course certificate through the shared progress service, then apply form overrides. */
async function issueCourseCertificate(learner: User, course: Course, opts: IssueOptions): Promise<Certificate> {
  const cert = await issueCertificate(learner, course, { batchId: opts.batchId, evaluatorId: opts.evaluatorId, expiryDate: opts.expiryDate, issuedById: opts.issuedById });
  if (
    cert.issueDate !== opts.issueDate ||
    cert.published !== opts.published ||
    cert.templateId !== opts.templateId ||
    (opts.evaluatorId && cert.evaluatorId !== opts.evaluatorId)
  ) {
    await mutate((d) => {
      const row = d.certificates.find((c) => c.id === cert.id);
      if (!row) return;
      row.issueDate = opts.issueDate;
      row.published = opts.published;
      row.templateId = opts.templateId;
      if (opts.evaluatorId) row.evaluatorId = opts.evaluatorId;
    });
  }
  return { ...cert, issueDate: opts.issueDate, published: opts.published, templateId: opts.templateId };
}

/**
 * Batch certificate: `progress.issueCertificate` only covers courses, so a
 * batch-level certificate (batchId, no courseId) is created here.
 */
async function issueBatchCertificate(learner: User, batch: Batch, opts: IssueOptions): Promise<Certificate> {
  const cert: Certificate = {
    id: uid("cert"),
    code: `LL-${shortCode(2, 4)}`,
    userId: learner.id,
    batchId: batch.id,
    evaluatorId: opts.evaluatorId,
    issueDate: opts.issueDate,
    expiryDate: opts.expiryDate,
    published: opts.published,
    templateId: opts.templateId,
  };
  // Re-checked inside the write lock so concurrent requests never create two batch certificates.
  const duplicate = await mutate((d) => {
    const already = d.certificates.find((c) => c.userId === learner.id && c.batchId === batch.id && !c.courseId);
    if (already) return already;
    d.certificates.push(cert);
    return null;
  });
  if (duplicate) return duplicate;
  emit("certificate.issued", { certificateId: cert.id, code: cert.code, userId: learner.id, batchId: batch.id });
  await notify(learner.id, {
    type: "certificate",
    subject: "Your certificate is ready",
    message: `Congratulations on completing ${batch.title}!`,
    link: `/certificates/${cert.code}`,
  });
  await evaluateBadges(learner.id, "certificate_issued");
  await awardCertificatePoints(cert, { grantedBy: opts.issuedById ?? opts.evaluatorId });
  return cert;
}

/* ------------------------------------------------------------------ */
/* Issue (single)                                                      */
/* ------------------------------------------------------------------ */

export async function issueCertificateAction(_prev: ActionResult<{ code: string }> | null, formData: FormData): Promise<ActionResult<{ code: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canIssueCertificates(user)) return { ok: false, error: "You are not permitted to issue certificates." };

  const learnerId = fd(formData, "userId");
  const target = fd(formData, "target") === "batch" ? "batch" : "course";
  const courseId = fd(formData, "courseId");
  const batchId = fd(formData, "batchId");
  const evaluatorId = fd(formData, "evaluatorId");
  const published = fdBool(formData, "published");
  const allowIncomplete = fdBool(formData, "allowIncomplete");
  const { issueDate, expiryDate, errors } = parseDates(fd(formData, "issueDate"), fd(formData, "expiryDate"));
  const templateId = parseTemplate(fd(formData, "templateId"), errors);

  const db = await getDb();
  const learner = db.users.find((u) => u.id === learnerId);
  if (!learner) errors.userId = "Choose a learner.";
  if (target === "course" && !courseId) errors.courseId = "Course or Batch is required to issue a certificate.";
  if (target === "batch" && !batchId) errors.batchId = "Course or Batch is required to issue a certificate.";
  const course = target === "course" ? db.courses.find((c) => c.id === courseId) : undefined;
  const batch = target === "batch" ? db.batches.find((b) => b.id === batchId) : undefined;
  if (target === "course" && courseId && !course) errors.courseId = "That course no longer exists.";
  if (target === "batch" && batchId && !batch) errors.batchId = "That batch no longer exists.";
  if (evaluatorId) {
    const evaluator = db.users.find((u) => u.id === evaluatorId);
    if (!evaluator || !isEvaluatorRole(evaluator)) errors.evaluatorId = "Choose an evaluator.";
  }
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  const opts: IssueOptions = { issueDate: issueDate!, expiryDate, evaluatorId: evaluatorId || undefined, published, templateId, issuedById: user.id };
  let cert: Certificate;
  if (course) {
    const blocker = await courseCertificateBlocker(learner!, course, { allowIncomplete });
    if (blocker) return { ok: false, error: blocker };
    cert = await issueCourseCertificate(learner!, course, opts);
    revalidateCertificates([`/courses/${course.slug}/certification`, `/courses/${course.slug}`]);
  } else {
    const blocker = await batchCertificateBlocker(learner!, batch!);
    if (blocker) return { ok: false, error: blocker };
    cert = await issueBatchCertificate(learner!, batch!, { ...opts, batchId: batch!.id });
    revalidateCertificates([`/batches/${batch!.slug}`]);
  }
  await audit(user, "certificate.issue", { type: "certificate", id: cert.id }, { code: cert.code, userId: learner!.id, courseId: course?.id ?? null, batchId: batch?.id ?? null });
  revalidatePath(`/user/${learner!.username}`);
  await setFlash(`Certificate ${cert.code} issued to ${learner!.name}`);
  redirect("/admin/certificates");
}

/* ------------------------------------------------------------------ */
/* Bulk issue for a batch                                              */
/* ------------------------------------------------------------------ */

export interface BulkIssueResult {
  issued: { name: string; code: string }[];
  skipped: { name: string; reason: string }[];
}

export async function bulkIssueCertificatesAction(_prev: ActionResult<BulkIssueResult> | null, formData: FormData): Promise<ActionResult<BulkIssueResult>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canIssueCertificates(user)) return { ok: false, error: "You are not permitted to generate certificates for this batch." };

  const batchId = fd(formData, "batchId");
  const courseId = fd(formData, "courseId");
  const evaluatorId = fd(formData, "evaluatorId");
  const published = fdBool(formData, "published");
  const userIds = Array.from(new Set(formData.getAll("userIds").filter((v): v is string => typeof v === "string" && v.length > 0)));
  const { issueDate, expiryDate, errors } = parseDates(fd(formData, "issueDate"), fd(formData, "expiryDate"));
  const templateId = parseTemplate(fd(formData, "templateId"), errors);

  const db = await getDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  if (!batch.certification) return { ok: false, error: "Certificates are not enabled for this batch." };
  let course: Course | undefined;
  if (courseId) {
    course = db.courses.find((c) => c.id === courseId);
    if (!course || !batch.courseIds.includes(courseId)) errors.courseId = "Choose one of this batch's courses.";
  }
  if (evaluatorId) {
    const evaluator = db.users.find((u) => u.id === evaluatorId);
    if (!evaluator || !isEvaluatorRole(evaluator)) errors.evaluatorId = "Choose an evaluator.";
  }
  if (!userIds.length) errors.userIds = "Select at least one student.";
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  const opts: IssueOptions = { issueDate: issueDate!, expiryDate, evaluatorId: evaluatorId || undefined, published, batchId: batch.id, templateId, issuedById: user.id };
  const result: BulkIssueResult = { issued: [], skipped: [] };
  for (const id of userIds) {
    const learner = db.users.find((u) => u.id === id);
    if (!learner) {
      result.skipped.push({ name: "Unknown user", reason: "This user no longer exists." });
      continue;
    }
    try {
      if (!db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === learner.id)) {
        result.skipped.push({ name: learner.name, reason: "Certification cannot be issued as the member is not enrolled in this batch." });
        continue;
      }
      if (course) {
        const blocker = await courseCertificateBlocker(learner, course, { allowIncomplete: true });
        if (blocker) {
          result.skipped.push({ name: learner.name, reason: blocker });
          continue;
        }
        const cert = await issueCourseCertificate(learner, course, opts);
        result.issued.push({ name: learner.name, code: cert.code });
      } else {
        const blocker = await batchCertificateBlocker(learner, batch);
        if (blocker) {
          result.skipped.push({ name: learner.name, reason: blocker });
          continue;
        }
        const cert = await issueBatchCertificate(learner, batch, opts);
        result.issued.push({ name: learner.name, code: cert.code });
      }
    } catch {
      result.skipped.push({ name: learner.name, reason: "Unable to generate certificate" });
    }
  }

  if (result.issued.length) await audit(user, "certificate.bulk_issue", { type: "batch", id: batch.id }, { issued: result.issued.length, skipped: result.skipped.length, courseId: course?.id ?? null });
  revalidateCertificates([`/batches/${batch.slug}`, `/admin/certificates/bulk`]);
  if (!result.skipped.length) {
    await setFlash(result.issued.length === 1 ? "Certificate generated successfully" : "Certificates generated successfully");
    redirect(`/admin/certificates?batch=${batch.id}`);
  }
  return {
    ok: true,
    data: result,
    message: result.issued.length
      ? `Generated ${result.issued.length} certificate${result.issued.length === 1 ? "" : "s"}; ${result.skipped.length} skipped.`
      : "No certificates were generated.",
  };
}

/* ------------------------------------------------------------------ */
/* Publish / revoke                                                    */
/* ------------------------------------------------------------------ */

export async function setCertificatePublishedAction(id: string, published: boolean): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canIssueCertificates(user)) return { ok: false, error: "You are not permitted to manage certificates." };
  const updated = await mutate((d) => {
    const row = d.certificates.find((c) => c.id === id);
    if (!row) return null;
    row.published = !!published;
    return { ...row };
  });
  if (!updated) return { ok: false, error: "This certificate no longer exists." };
  revalidateCertificates([`/certificates/${updated.code}`]);
  return { ok: true, data: undefined, message: published ? "Certificate published" : "Certificate unpublished" };
}

export async function revokeCertificateAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  if (!canIssueCertificates(user)) return { ok: false, error: "You are not permitted to revoke certificates." };
  const removed = await mutate((d) => {
    const row = d.certificates.find((c) => c.id === id);
    if (!row) return null;
    d.certificates = d.certificates.filter((c) => c.id !== id);
    for (const e of d.enrollments) if (e.certificateId === id) e.certificateId = undefined;
    return row;
  });
  if (!removed) return { ok: false, error: "This certificate no longer exists." };
  // A revoked certificate takes its points back (re-issuing it pays once again, never twice).
  await revokeCertificatePoints(removed);
  await audit(user, "certificate.revoke", { type: "certificate", id: removed.id }, { code: removed.code, userId: removed.userId });
  const db = await getDb();
  const course = removed.courseId ? db.courses.find((c) => c.id === removed.courseId) : undefined;
  const learner = db.users.find((u) => u.id === removed.userId);
  revalidateCertificates([
    `/certificates/${removed.code}`,
    ...(course ? [`/courses/${course.slug}/certification`, `/courses/${course.slug}`] : []),
    ...(learner ? [`/user/${learner.username}`] : []),
  ]);
  return { ok: true, data: undefined, message: `Certificate ${removed.code} revoked` };
}

/* ------------------------------------------------------------------ */
/* Learner: completion certificate                                     */
/* ------------------------------------------------------------------ */

/**
 * "Get Certificate" for free completion-certificate courses: returns the
 * learner's existing certificate or issues one when progress is 100%.
 */
export async function claimCompletionCertificateAction(courseId: string): Promise<ActionResult<{ code: string; href: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to get your certificate." };
  const db = await getDb();
  const course = db.courses.find((c) => c.id === courseId);
  if (!course) return { ok: false, error: "This course no longer exists." };
  const existing = db.certificates.find((c) => c.userId === user.id && c.courseId === course.id);
  if (existing) return { ok: true, data: { code: existing.code, href: `/certificates/${existing.code}` } };
  if (!db.settings.features.certifications) return { ok: false, error: "Certificates are currently turned off." };
  const enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
  if (!enrollment) return { ok: false, error: "You are not enrolled in this course." };
  if (!course.enableCertification || course.paidCertificate) return { ok: false, error: "Certification is not enabled for this course." };
  if (enrollment.progress < 100) return { ok: false, error: "You have not completed the course yet." };
  const cert = await issueCertificate(user, course);
  if (!cert.templateId) {
    await mutate((d) => {
      const row = d.certificates.find((c) => c.id === cert.id);
      if (row && !row.templateId) row.templateId = DEFAULT_CERTIFICATE_TEMPLATE_ID;
    });
  }
  revalidateCertificates([`/courses/${course.slug}/certification`, `/courses/${course.slug}`, `/user/${user.username}`]);
  return { ok: true, data: { code: cert.code, href: `/certificates/${cert.code}` }, message: "Your certificate is ready" };
}

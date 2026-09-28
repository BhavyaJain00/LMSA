"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, JobApplication, JobOpening } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { canManageJob, canPostJobs, parseJobType } from "@/lib/data/jobs";
import { notify } from "@/lib/services/notifications";
import { setFlash } from "@/lib/flash";
import { fd, fdBool, isValidUrl, uid, uniqueSlug } from "@/lib/utils";

/**
 * Job board mutations (Frappe: Job Opportunity + LMS Job Application).
 * Staff post jobs; posters and moderators manage them; any signed-in member
 * can apply once per job.
 */

type Errors = Record<string, string>;

function fail<T = undefined>(errors: Errors): ActionResult<T> {
  return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };
}

function revalidateJobs(slug?: string, id?: string) {
  revalidatePath("/jobs");
  revalidatePath("/jobs/applications");
  revalidatePath("/admin/jobs");
  if (slug) revalidatePath(`/jobs/${slug}`);
  if (id) {
    revalidatePath(`/admin/jobs/${id}`);
    revalidatePath(`/admin/jobs/${id}/applications`);
  }
}

function normalizeWebsite(raw: string): string {
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Create or update a job opening. Redirects to the job page on success. */
export async function saveJobAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  if (!db.settings.features.jobs) return { ok: false, error: "The job board is disabled on this platform." };

  const id = fd(formData, "id");
  const existing = id ? db.jobs.find((j) => j.id === id) : null;
  if (id && !existing) return { ok: false, error: "This job opening no longer exists." };
  if (existing ? !canManageJob(user, existing) : !canPostJobs(user)) {
    return { ok: false, error: "You are not permitted to manage this job opening." };
  }

  const title = fd(formData, "title");
  const company = fd(formData, "company");
  const location = fd(formData, "location");
  const type = parseJobType(fd(formData, "type"));
  const remote = fdBool(formData, "remote");
  const description = fd(formData, "description");
  const salaryRange = fd(formData, "salaryRange");
  const companyWebsite = normalizeWebsite(fd(formData, "companyWebsite"));
  const companyLogoUrl = fd(formData, "companyLogoUrl");
  const status = fd(formData, "status");

  const errors: Errors = {};
  if (!title) errors.title = "Title is required";
  else if (title.length > 120) errors.title = "Keep the title under 120 characters.";
  if (!type) errors.type = "Type is required";
  if (!company) errors.company = "Company Name is required";
  else if (company.length > 100) errors.company = "Keep the company name under 100 characters.";
  if (!location) errors.location = "City is required";
  else if (location.length > 120) errors.location = "Keep the location under 120 characters.";
  if (!description) errors.description = "Description is required";
  else if (description.length < 30) errors.description = "Describe the role in at least 30 characters.";
  else if (description.length > 20000) errors.description = "The description is too long (20,000 characters max).";
  if (salaryRange.length > 60) errors.salaryRange = "Keep the salary range under 60 characters.";
  if (companyWebsite && !isValidUrl(companyWebsite)) errors.companyWebsite = "Please enter a valid website URL (http or https).";
  if (companyLogoUrl && !(companyLogoUrl.startsWith("/") ? !companyLogoUrl.startsWith("//") : isValidUrl(companyLogoUrl))) {
    errors.companyLogoUrl = "Upload an image or enter a valid URL.";
  }
  if (existing && status !== "open" && status !== "closed") errors.status = "Status is required";
  if (Object.keys(errors).length || !type) return fail(errors);

  const now = new Date().toISOString();
  let slug: string;
  let jobId: string;
  if (existing) {
    slug = existing.slug;
    jobId = existing.id;
    await mutate((d) => {
      const row = d.jobs.find((j) => j.id === existing.id);
      if (!row) return;
      row.title = title;
      row.company = company;
      row.location = location;
      row.type = type;
      row.remote = remote;
      row.description = description;
      row.salaryRange = salaryRange || undefined;
      row.companyWebsite = companyWebsite || undefined;
      row.companyLogoUrl = companyLogoUrl || undefined;
      row.status = status as JobOpening["status"];
      row.updatedAt = now;
    });
  } else {
    slug = uniqueSlug(`${title}-${company}`, db.jobs.map((j) => j.slug));
    jobId = uid("job");
    const job: JobOpening = {
      id: jobId,
      slug,
      title,
      company,
      companyLogoUrl: companyLogoUrl || undefined,
      companyWebsite: companyWebsite || undefined,
      location,
      remote,
      type,
      description,
      salaryRange: salaryRange || undefined,
      postedById: user.id,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    await mutate((d) => {
      d.jobs.push(job);
    });
  }
  revalidateJobs(slug, jobId);
  await setFlash(existing ? "Job opening updated" : "Job opening published", "success");
  redirect(`/jobs/${slug}`);
}

/** Open or close a job opening. */
export async function setJobStatusAction(id: string, status: "open" | "closed"): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const job = db.jobs.find((j) => j.id === id);
  if (!job) return { ok: false, error: "This job opening no longer exists." };
  if (!canManageJob(user, job)) return { ok: false, error: "You are not permitted to manage this job opening." };
  if (status !== "open" && status !== "closed") return { ok: false, error: "Invalid status." };
  await mutate((d) => {
    const row = d.jobs.find((j) => j.id === id);
    if (row) {
      row.status = status;
      row.updatedAt = new Date().toISOString();
    }
  });
  revalidateJobs(job.slug, job.id);
  return { ok: true, data: undefined, message: status === "closed" ? "Job closed — it no longer accepts applications." : "Job reopened." };
}

/** Delete a job opening and all of its applications. */
export async function deleteJobAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const job = db.jobs.find((j) => j.id === id);
  if (!job) return { ok: false, error: "This job opening no longer exists." };
  if (!canManageJob(user, job)) return { ok: false, error: "You are not permitted to manage this job opening." };
  await mutate((d) => {
    d.jobs = d.jobs.filter((j) => j.id !== id);
    d.jobApplications = d.jobApplications.filter((a) => a.jobId !== id);
  });
  revalidateJobs(job.slug, job.id);
  return { ok: true, data: undefined, message: "Job opening deleted" };
}

/** Apply to an open job with a PDF resume and an optional cover letter. */
export async function applyToJobAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please log in to apply." };
  const db = await getDb();
  const jobId = fd(formData, "jobId");
  const job = db.jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, error: "This job opening no longer exists." };
  if (job.status !== "open") return { ok: false, error: "This job is no longer accepting applications." };
  if (db.jobApplications.some((a) => a.jobId === job.id && a.userId === user.id)) {
    return { ok: false, error: "You have already applied for this job." };
  }

  const resumeUrl = fd(formData, "resumeUrl");
  const coverLetter = fd(formData, "coverLetter");
  const errors: Errors = {};
  if (!resumeUrl) errors.resumeUrl = "Please upload your resume";
  else if (!/\.pdf(\?|$)/i.test(resumeUrl) || !(resumeUrl.startsWith("/uploads/") || isValidUrl(resumeUrl))) errors.resumeUrl = "Only PDF file is allowed";
  if (coverLetter.length > 5000) errors.coverLetter = "Keep your cover letter under 5,000 characters.";
  if (Object.keys(errors).length) return fail(errors);

  const application: JobApplication = {
    id: uid("japp"),
    jobId: job.id,
    userId: user.id,
    resumeUrl,
    coverLetter: coverLetter || undefined,
    createdAt: new Date().toISOString(),
  };
  await mutate((d) => {
    d.jobApplications.push(application);
  });
  if (job.postedById !== user.id) {
    await notify(job.postedById, {
      type: "system",
      subject: `${user.name} applied for ${job.title}`,
      message: `New application at ${job.company}.`,
      link: `/admin/jobs/${job.id}/applications`,
      fromUserId: user.id,
    });
  }
  revalidateJobs(job.slug, job.id);
  return { ok: true, data: undefined, message: "Your application has been submitted successfully" };
}

/** Withdraw your own application. */
export async function withdrawApplicationAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const application = db.jobApplications.find((a) => a.id === id);
  if (!application || application.userId !== user.id) return { ok: false, error: "Application not found." };
  const job = db.jobs.find((j) => j.id === application.jobId);
  await mutate((d) => {
    d.jobApplications = d.jobApplications.filter((a) => a.id !== id);
  });
  revalidateJobs(job?.slug, job?.id);
  return { ok: true, data: undefined, message: "Application withdrawn" };
}

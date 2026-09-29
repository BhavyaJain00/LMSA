import type { JobOpening } from "@/lib/types";
import { resolveWorkMode } from "./work-mode";

/** The fields of a job opening that JobForm edits (safe to pass to the client). */
export type JobFormValues = Pick<
  JobOpening,
  "id" | "slug" | "title" | "company" | "companyLogoUrl" | "companyWebsite" | "location" | "country" | "remote" | "workMode" | "type" | "description" | "salaryRange" | "status"
>;

/** Pick the editable fields, filling in the work mode for records saved before it existed. */
export function toJobFormValues(job: JobOpening): JobFormValues {
  return {
    id: job.id,
    slug: job.slug,
    title: job.title,
    company: job.company,
    companyLogoUrl: job.companyLogoUrl,
    companyWebsite: job.companyWebsite,
    location: job.location,
    country: job.country,
    remote: job.remote,
    workMode: resolveWorkMode(job),
    type: job.type,
    description: job.description,
    salaryRange: job.salaryRange,
    status: job.status,
  };
}

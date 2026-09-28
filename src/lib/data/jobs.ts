import "server-only";
import type { JobApplication, JobOpening, JobType, PublicUser, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { isModerator, isStaff, toPublicUser } from "@/lib/auth/session";
import { jobTypes } from "@/lib/config";

/**
 * Job board queries (Frappe: Job Opportunity / LMS Job Application).
 * Open jobs are public; closed jobs are visible to moderators and to the
 * member who posted them.
 */

export const JOB_TYPE_LABELS: Record<JobType, string> = Object.fromEntries(jobTypes.map((t) => [t.value, t.label])) as Record<JobType, string>;

export type WorkMode = "remote" | "onsite";
export type JobStatusTab = "open" | "closed";

export const JOBS_PAGE_SIZE = 24;

export function parseJobType(raw: string | undefined | null): JobType | undefined {
  return jobTypes.some((t) => t.value === raw) ? (raw as JobType) : undefined;
}

export function parseWorkMode(raw: string | undefined | null): WorkMode | undefined {
  return raw === "remote" || raw === "onsite" ? raw : undefined;
}

/** Owner or moderator (Frappe: canManageJob). */
export function canManageJob(user: Pick<User, "id" | "roles"> | null | undefined, job: Pick<JobOpening, "postedById">): boolean {
  if (!user) return false;
  return isModerator(user) || job.postedById === user.id;
}

/** Staff members (instructors, evaluators, moderators, admins) can post jobs. */
export function canPostJobs(user: Pick<User, "roles"> | null | undefined): boolean {
  return isStaff(user);
}

export interface JobSummary extends JobOpening {
  applicantCount: number;
  poster: Pick<PublicUser, "id" | "name" | "username" | "avatarUrl"> | null;
}

export interface JobFilter {
  status: JobStatusTab;
  search?: string;
  type?: JobType;
  workMode?: WorkMode;
}

async function summarize(jobs: JobOpening[]): Promise<JobSummary[]> {
  const db = await getDb();
  const counts = new Map<string, number>();
  for (const a of db.jobApplications) counts.set(a.jobId, (counts.get(a.jobId) ?? 0) + 1);
  const users = new Map(db.users.map((u) => [u.id, u]));
  return jobs.map((j) => {
    const poster = users.get(j.postedById);
    return {
      ...j,
      applicantCount: counts.get(j.id) ?? 0,
      poster: poster ? { id: poster.id, name: poster.name, username: poster.username, avatarUrl: poster.avatarUrl } : null,
    };
  });
}

function matchesSearch(job: JobOpening, search: string | undefined): boolean {
  if (!search) return true;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(q);
}

/** Jobs for the public board. Closed jobs are scoped to the viewer unless they moderate. */
export async function getJobs(viewer: User | null, filter: JobFilter): Promise<JobSummary[]> {
  const db = await getDb();
  const list = db.jobs.filter((j) => {
    if (j.status !== filter.status) return false;
    if (filter.status === "closed") {
      if (!viewer) return false;
      if (!isModerator(viewer) && j.postedById !== viewer.id) return false;
    }
    if (filter.type && j.type !== filter.type) return false;
    if (filter.workMode === "remote" && !j.remote) return false;
    if (filter.workMode === "onsite" && j.remote) return false;
    return matchesSearch(j, filter.search);
  });
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summarize(list);
}

/** Whether the "Closed" tab should be shown to this viewer. */
export async function countVisibleClosedJobs(viewer: User | null): Promise<number> {
  if (!viewer) return 0;
  const db = await getDb();
  return db.jobs.filter((j) => j.status === "closed" && (isModerator(viewer) || j.postedById === viewer.id)).length;
}

export async function getJobBySlug(slug: string): Promise<JobSummary | null> {
  const db = await getDb();
  const job = db.jobs.find((j) => j.slug === slug || j.id === slug);
  if (!job) return null;
  const [summary] = await summarize([job]);
  return summary ?? null;
}

export async function getJobById(id: string): Promise<JobSummary | null> {
  const db = await getDb();
  const job = db.jobs.find((j) => j.id === id);
  if (!job) return null;
  const [summary] = await summarize([job]);
  return summary ?? null;
}

export async function getUserApplication(userId: string | undefined | null, jobId: string): Promise<JobApplication | null> {
  if (!userId) return null;
  const db = await getDb();
  return db.jobApplications.find((a) => a.userId === userId && a.jobId === jobId) ?? null;
}

export interface MyApplication extends JobApplication {
  job: JobOpening | null;
}

export async function getMyApplications(userId: string): Promise<MyApplication[]> {
  const db = await getDb();
  const jobs = new Map(db.jobs.map((j) => [j.id, j]));
  return db.jobApplications
    .filter((a) => a.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({ ...a, job: jobs.get(a.jobId) ?? null }));
}

export interface ApplicationWithApplicant extends JobApplication {
  applicant: Pick<PublicUser, "id" | "name" | "email" | "username" | "avatarUrl" | "headline"> | null;
}

export async function getJobApplications(jobId: string, search?: string): Promise<ApplicationWithApplicant[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, toPublicUser(u)]));
  const q = search?.trim().toLowerCase();
  return db.jobApplications
    .filter((a) => a.jobId === jobId)
    .map((a) => {
      const u = users.get(a.userId);
      return {
        ...a,
        applicant: u ? { id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl, headline: u.headline } : null,
      };
    })
    .filter((a) => !q || `${a.applicant?.name ?? ""} ${a.applicant?.email ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Jobs listed in the admin area: everything for moderators, own postings for other staff. */
export async function getManagedJobs(viewer: User, filter: { status: "all" | JobStatusTab; search?: string }): Promise<JobSummary[]> {
  const db = await getDb();
  const list = db.jobs.filter((j) => {
    if (!isModerator(viewer) && j.postedById !== viewer.id) return false;
    if (filter.status !== "all" && j.status !== filter.status) return false;
    return matchesSearch(j, filter.search);
  });
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summarize(list);
}

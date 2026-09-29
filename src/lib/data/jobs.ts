import "server-only";
import type { JobApplication, JobOpening, JobType, PublicUser, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { isModerator, toPublicUser } from "@/lib/auth/session";
import { jobTypes } from "@/lib/config";
import { parseWorkMode as parseMode, resolveWorkMode, type WorkMode } from "@/components/jobs/work-mode";

/**
 * Job board queries (Frappe: Job Opportunity / LMS Job Application).
 * Open jobs are public; closed jobs are visible to moderators and to the
 * member who posted them. Any signed-in member may post jobs (Frappe grants
 * LMS Student create/write on their own Job Opportunity records).
 */

export const JOB_TYPE_LABELS: Record<JobType, string> = Object.fromEntries(jobTypes.map((t) => [t.value, t.label])) as Record<JobType, string>;

export type { WorkMode };
export type JobStatusTab = "open" | "closed";

export const JOBS_PAGE_SIZE = 24;

export function parseJobType(raw: string | undefined | null): JobType | undefined {
  return jobTypes.some((t) => t.value === raw) ? (raw as JobType) : undefined;
}

export function parseWorkMode(raw: string | undefined | null): WorkMode | undefined {
  return parseMode(raw);
}

/** Paths under /jobs that are real routes, so no job may use them as its slug. */
export const RESERVED_JOB_SLUGS = ["new", "mine", "applications"] as const;

/** Owner or moderator (Frappe: canManageJob). */
export function canManageJob(user: Pick<User, "id" | "roles"> | null | undefined, job: Pick<JobOpening, "postedById">): boolean {
  if (!user) return false;
  return isModerator(user) || job.postedById === user.id;
}

/**
 * Any signed-in member can post jobs while the job board is enabled
 * (Frappe: LMS Student has create/write on their own Job Opportunity).
 * Pass the platform's `features.jobs` flag.
 */
export function canPostJobs(user: Pick<User, "id"> | null | undefined, jobsEnabled: boolean): boolean {
  return !!user && jobsEnabled;
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
  /** Exact country (case-insensitive). */
  country?: string;
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
  return `${job.title} ${job.company} ${job.location} ${job.country ?? ""}`.toLowerCase().includes(q);
}

/** Status visibility on the board: closed jobs belong to their poster unless the viewer moderates. */
function visibleOnBoard(job: JobOpening, viewer: User | null, status: JobStatusTab): boolean {
  if (job.status !== status) return false;
  if (status === "closed") {
    if (!viewer) return false;
    if (!isModerator(viewer) && job.postedById !== viewer.id) return false;
  }
  return true;
}

/** Jobs for the public board. Closed jobs are scoped to the viewer unless they moderate. */
export async function getJobs(viewer: User | null, filter: JobFilter): Promise<JobSummary[]> {
  const db = await getDb();
  const country = filter.country?.trim().toLowerCase();
  const list = db.jobs.filter((j) => {
    if (!visibleOnBoard(j, viewer, filter.status)) return false;
    if (filter.type && j.type !== filter.type) return false;
    if (filter.workMode && resolveWorkMode(j) !== filter.workMode) return false;
    if (country && (j.country ?? "").trim().toLowerCase() !== country) return false;
    return matchesSearch(j, filter.search);
  });
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summarize(list);
}

/** Countries used by the jobs this viewer can see under a status tab (Country filter options). */
export async function getJobCountries(viewer: User | null, status: JobStatusTab): Promise<string[]> {
  const db = await getDb();
  const seen = new Map<string, string>();
  for (const j of db.jobs) {
    const c = j.country?.trim();
    if (!c || !visibleOnBoard(j, viewer, status)) continue;
    if (!seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Number of jobs this member has posted (drives the "My job posts" entry). */
export async function countJobsPostedBy(userId: string | undefined | null): Promise<number> {
  if (!userId) return 0;
  const db = await getDb();
  return db.jobs.filter((j) => j.postedById === userId).length;
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

/**
 * Jobs a member manages: everything for moderators, their own postings for
 * everyone else. `onlyOwn` restricts moderators to their own posts too
 * (the learner "My job posts" page).
 */
export async function getManagedJobs(viewer: User, filter: { status: "all" | JobStatusTab; search?: string; onlyOwn?: boolean }): Promise<JobSummary[]> {
  const db = await getDb();
  const list = db.jobs.filter((j) => {
    if ((filter.onlyOwn || !isModerator(viewer)) && j.postedById !== viewer.id) return false;
    if (filter.status !== "all" && j.status !== filter.status) return false;
    return matchesSearch(j, filter.search);
  });
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summarize(list);
}

/** Open jobs untouched for longer than this are closed automatically (Frappe closes jobs open for more than 3 months). */
export const JOB_AUTO_CLOSE_DAYS = 90;

/**
 * Close job openings that have been open for more than three months.
 * Cheap and idempotent: it only writes when something is actually stale, so
 * the job board pages call it on every request instead of a scheduler.
 */
export async function closeExpiredJobs(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const cutoff = now.getTime() - JOB_AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000;
  // Measured from the last update, so reopening or editing a job gives it another three months.
  const stale = db.jobs.filter((j) => j.status === "open" && new Date(j.updatedAt || j.createdAt).getTime() < cutoff);
  if (!stale.length) return 0;
  const ids = new Set(stale.map((j) => j.id));
  const stamp = now.toISOString();
  await mutate((d) => {
    for (const job of d.jobs) {
      if (ids.has(job.id) && job.status === "open") {
        job.status = "closed";
        job.updatedAt = stamp;
      }
    }
  });
  return stale.length;
}

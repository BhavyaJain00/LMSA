import type { JobOpening } from "@/lib/types";

/**
 * Work mode of a job opening (Frappe: work_mode On-site | Hybrid | Remote).
 * Older records only carry the boolean `remote`; `resolveWorkMode` derives
 * the mode from it so both shapes read the same everywhere.
 */

export type WorkMode = NonNullable<JobOpening["workMode"]>;

export const WORK_MODES: readonly { value: WorkMode; label: string }[] = [
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
];

export const WORK_MODE_LABEL: Record<WorkMode, string> = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" };

export function isWorkMode(raw: unknown): raw is WorkMode {
  return raw === "onsite" || raw === "hybrid" || raw === "remote";
}

export function parseWorkMode(raw: string | undefined | null): WorkMode | undefined {
  return isWorkMode(raw) ? raw : undefined;
}

export function resolveWorkMode(job: Pick<JobOpening, "remote" | "workMode">): WorkMode {
  return job.workMode ?? (job.remote ? "remote" : "onsite");
}

/** "Berlin, Germany" — the city plus the country when it is set and not already part of the city. */
export function formatJobLocation(job: Pick<JobOpening, "location" | "country">): string {
  const country = job.country?.trim();
  if (!country || job.location.toLowerCase().includes(country.toLowerCase())) return job.location;
  return `${job.location}, ${country}`;
}

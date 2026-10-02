import Link from "next/link";
import type { JobOpening, JobType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn, initials } from "@/lib/utils";
import { jobTypes } from "@/lib/config";
import { WORK_MODE_LABEL, formatJobLocation, resolveWorkMode } from "./work-mode";
import { getFormatter, getT } from "@/i18n/server";

export const JOB_TYPE_LABEL: Record<JobType, string> = Object.fromEntries(jobTypes.map((t) => [t.value, t.label])) as Record<JobType, string>;

/** English work mode label (admin lists); the public pages use `jobs.mode.*` messages. */
export function workModeLabel(job: Pick<JobOpening, "remote" | "workMode">): string {
  return WORK_MODE_LABEL[resolveWorkMode(job)];
}

/** Badge tone per work mode: remote stands out, hybrid is outlined, on-site is neutral. */
export function workModeTone(job: Pick<JobOpening, "remote" | "workMode">): "info" | "outline" | "neutral" {
  const mode = resolveWorkMode(job);
  return mode === "remote" ? "info" : mode === "hybrid" ? "outline" : "neutral";
}

export { formatJobLocation };

const LOGO_SIZES = { sm: "size-10 text-sm rounded-lg", md: "size-12 text-base rounded-xl", lg: "size-16 text-lg rounded-2xl" } as const;

/** Company logo, or the company's initials on a neutral tile. */
export async function CompanyLogo({ company, logoUrl, size = "md", className }: { company: string; logoUrl?: string; size?: keyof typeof LOGO_SIZES; className?: string }) {
  if (logoUrl) {
    const t = await getT("public");
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={t("jobs.logoAlt", { company })} className={cn("shrink-0 border border-border bg-surface-1 object-contain p-1", LOGO_SIZES[size], className)} />;
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center bg-accent/10 font-semibold text-accent", LOGO_SIZES[size], className)} aria-hidden="true">
      {initials(company)}
    </span>
  );
}

export interface JobCardData extends Pick<JobOpening, "slug" | "title" | "company" | "companyLogoUrl" | "location" | "country" | "remote" | "workMode" | "type" | "salaryRange" | "status" | "createdAt"> {
  applicantCount: number;
}

/** Job board card (Frappe: JobCard). Whole card is a link to the job. */
export async function JobCard({ job, showApplicants }: { job: JobCardData; showApplicants: boolean }) {
  const [t, f] = await Promise.all([getT("public"), getFormatter()]);
  return (
    <Link
      href={`/jobs/${job.slug}`}
      className="group flex h-full flex-col rounded-card border border-border bg-surface-1 p-4 shadow-card transition-colors hover:border-border-strong focus-visible:border-accent"
    >
      <div className="flex items-start gap-3">
        <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-muted">{job.company}</p>
          <h3 className="line-clamp-2 font-semibold leading-snug text-ink group-hover:text-accent">{job.title}</h3>
        </div>
      </div>
      <div className="mt-3 space-y-1 text-sm text-ink-muted">
        <p className="flex items-center gap-1.5">
          <Icon.MapPin className="size-4 shrink-0 text-ink-faint" />
          <span className="truncate">{formatJobLocation(job)}</span>
        </p>
        {job.salaryRange && (
          <p className="flex items-center gap-1.5">
            <Icon.CreditCard className="size-4 shrink-0 text-ink-faint" />
            <span className="truncate">{job.salaryRange}</span>
          </p>
        )}
        {showApplicants && job.applicantCount > 0 && (
          <p className="flex items-center gap-1.5">
            <Icon.User className="size-4 shrink-0 text-ink-faint" />
            {t("jobs.applicantCount", { count: job.applicantCount })}
          </p>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
        <Badge tone="accent">{t(`jobs.type.${job.type}`)}</Badge>
        <Badge tone={workModeTone(job)}>{t(`jobs.mode.${resolveWorkMode(job)}`)}</Badge>
        {job.status === "closed" && <Badge tone="danger">{t("jobs.status.closed")}</Badge>}
        <span className="ms-auto text-xs text-ink-faint">{f.relative(job.createdAt)}</span>
      </div>
    </Link>
  );
}

import Link from "next/link";
import type { EducationDetail, WorkExperience } from "@/lib/types";
import type { CompletenessItem, ProfileCertificate } from "@/lib/data/profile";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { ProgressRing } from "@/components/ui/progress";
import { cn, formatDate } from "@/lib/utils";

function monthLabel(ym: string | undefined): string {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function durationLabel(start?: string, end?: string, current?: boolean): string {
  if (!start) return "";
  const [sy, sm] = start.split("-").map(Number);
  let ey: number;
  let em: number;
  if (current || !end) {
    const now = new Date();
    ey = now.getFullYear();
    em = now.getMonth() + 1;
  } else {
    [ey, em] = end.split("-").map(Number) as [number, number];
  }
  if (!sy || !sm || !ey || !em) return "";
  const months = Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} ${years === 1 ? "yr" : "yrs"}`);
  if (rest) parts.push(`${rest} ${rest === 1 ? "mo" : "mos"}`);
  return parts.join(" ");
}

/** Vertical timeline of positions (newest first). */
export function WorkTimeline({ items }: { items: WorkExperience[] }) {
  const sorted = [...items].sort((a, b) => Number(!!b.current) - Number(!!a.current) || (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  return (
    <ol className="relative space-y-5 border-l border-border pl-5">
      {sorted.map((w) => {
        const range = [monthLabel(w.startDate), w.current ? "Present" : monthLabel(w.endDate)].filter(Boolean).join(" – ");
        const duration = durationLabel(w.startDate, w.endDate, w.current);
        return (
          <li key={w.id} className="relative">
            <span
              className={cn(
                "absolute -left-[27px] top-1 flex size-3.5 items-center justify-center rounded-full ring-4 ring-surface-1",
                w.current ? "bg-accent" : "bg-border-strong",
              )}
              aria-hidden="true"
            />
            <p className="font-medium text-ink">{w.title}</p>
            <p className="text-sm text-ink-muted">
              {w.company}
              {w.location && <span className="text-ink-faint"> · {w.location}</span>}
            </p>
            {(range || duration) && (
              <p className="mt-0.5 text-xs text-ink-faint">
                {range}
                {duration && ` · ${duration}`}
              </p>
            )}
            {w.description && <p className="mt-1.5 whitespace-pre-line text-sm text-ink-muted">{w.description}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export function EducationTimeline({ items }: { items: EducationDetail[] }) {
  const sorted = [...items].sort((a, b) => (b.endYear ?? b.startYear ?? 0) - (a.endYear ?? a.startYear ?? 0));
  return (
    <ol className="relative space-y-5 border-l border-border pl-5">
      {sorted.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[27px] top-1 size-3.5 rounded-full bg-border-strong ring-4 ring-surface-1" aria-hidden="true" />
          <p className="font-medium text-ink">{e.institution}</p>
          <p className="text-sm text-ink-muted">
            {e.degree}
            {e.fieldOfStudy && `, ${e.fieldOfStudy}`}
          </p>
          {(e.startYear || e.endYear) && (
            <p className="mt-0.5 text-xs text-ink-faint">{[e.startYear, e.endYear].filter(Boolean).join(" – ")}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Certificates grid; each card opens the public certificate page. */
export function CertificateGrid({ certificates }: { certificates: ProfileCertificate[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {certificates.map((c) => (
        <li key={c.id}>
          <Link
            href={c.href}
            className="group flex h-full flex-col rounded-card border border-border bg-surface-1 p-4 shadow-card transition-colors hover:border-border-strong"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                <Icon.Certificate className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="line-clamp-2 font-medium text-ink group-hover:text-accent">{c.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{c.kind === "course" ? "Course certificate" : "Batch certificate"}</p>
              </div>
            </div>
            <dl className="mt-4 space-y-1 text-xs text-ink-muted">
              <div className="flex gap-1">
                <dt>Issued on:</dt>
                <dd className="text-ink">{formatDate(c.issueDate)}</dd>
              </div>
              {c.expiryDate && (
                <div className="flex gap-1">
                  <dt>Valid until:</dt>
                  <dd className="text-ink">{formatDate(c.expiryDate)}</dd>
                </div>
              )}
              {c.evaluatorName && (
                <div className="flex gap-1">
                  <dt>Evaluated by:</dt>
                  <dd className="text-ink">{c.evaluatorName}</dd>
                </div>
              )}
            </dl>
            <p className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs">
              <span className="font-mono text-ink-faint">{c.code}</span>
              <span className="inline-flex items-center gap-1 font-medium text-accent">
                View <Icon.ArrowRight className="size-3.5 rtl:rotate-180" />
              </span>
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** "Complete your profile" card with a checklist (own profile only). */
export function ProfileCompletenessCard({ percent, items, editHref }: { percent: number; items: CompletenessItem[]; editHref: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <ProgressRing value={percent} size={48} stroke={5} tone={percent === 100 ? "success" : "accent"} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Complete your profile</p>
          <p className="text-xs text-ink-muted">Highlight what makes you unique and show your skills.</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((i) => (
          <li key={i.key} className={cn("flex items-center gap-2 text-sm", i.done ? "text-ink-faint line-through" : "text-ink")}>
            {i.done ? <Icon.CheckCircleFilled className="size-4 shrink-0 text-success" /> : <Icon.Circle className="size-4 shrink-0 text-ink-faint" />}
            {i.label}
          </li>
        ))}
      </ul>
      <ButtonLink href={editHref} size="sm" variant="subtle" className="mt-4 w-full" leftIcon={<Icon.Edit className="size-4" />}>
        Edit profile
      </ButtonLink>
    </Card>
  );
}

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { Icon } from "@/components/ui/icons";
import type { ProgramSummary } from "./types";
import { getT } from "@/i18n/server";

/** Program card: title, description, course & member counts and the viewer's progress. */
export async function ProgramCard({ program, href, showStatus = false, className }: { program: ProgramSummary; href?: string; showStatus?: boolean; className?: string }) {
  const t = await getT("public");
  const progress = program.progress ?? 0;
  return (
    <Link
      href={href ?? `/programs/${program.slug}`}
      className={cn(
        "group flex min-h-full flex-col rounded-card border border-border bg-surface-1 p-5 shadow-card transition-colors hover:border-border-strong focus-visible:border-accent",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon.Layers className="size-5" />
        </span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {showStatus && (program.published ? <Badge tone="success">{t("batches.detail.published")}</Badge> : <Badge tone="warning">{t("card.unpublished")}</Badge>)}
          {program.isMember && (
            <Badge tone="dark">
              <Icon.Check className="size-3" /> {t("enroll.enrolled")}
            </Badge>
          )}
        </div>
      </div>
      <h3 className="mt-4 text-lg font-semibold leading-snug text-ink group-hover:text-accent">{program.title}</h3>
      {program.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{program.description}</p>}
      {program.courseTitles.length > 0 && (
        <ol className="mt-3 space-y-1 text-xs text-ink-muted">
          {program.courseTitles.slice(0, 3).map((title, i) => (
            <li key={`${title}-${i}`} className="flex items-center gap-2">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold">{i + 1}</span>
              <span className="truncate">{title}</span>
            </li>
          ))}
          {program.courseTitles.length > 3 && <li className="ps-6">{t("programs.card.more", { count: program.courseTitles.length - 3 })}</li>}
        </ol>
      )}
      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon.BookOpen className="size-4" /> {t("catalog.courseCount", { count: program.courseCount })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon.User className="size-4" /> {t("programs.memberCount", { count: program.memberCount })}
          </span>
          {program.enforceCourseOrder && (
            <span className="inline-flex items-center gap-1.5" title={t("programs.inOrderHint")}>
              <Icon.Lock className="size-3.5" /> {t("programs.inOrder")}
            </span>
          )}
        </div>
        {program.isMember && (
          <div className="mt-3">
            <ProgressBar value={progress} size="sm" tone={progress >= 100 ? "success" : "accent"} label={t("programs.card.progressLabel", { title: program.title })} />
            <p className="mt-1 text-xs text-ink-muted">{t("card.progress", { percent: progress })}</p>
          </div>
        )}
      </div>
    </Link>
  );
}

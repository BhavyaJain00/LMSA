"use client";

/**
 * Small building blocks shared by the learner quiz pages, the admin quiz
 * pages and the quiz builder. Client components with `global.` messages, so
 * they render translated on every page (the admin pages and the builder do
 * not provide the `learning` namespace).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { QuizIcon } from "./icons";
import { formatScore, type SubmissionStatus, type UiQuestionType } from "./types";

/* ------------------------------------------------------------------ */
/* Breadcrumbs                                                          */
/* ------------------------------------------------------------------ */

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const t = useT("learning");
  return (
    <nav aria-label={t("global.quiz.breadcrumb")} className={cn("mb-2", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="max-w-[16rem] truncate hover:text-ink hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={cn("max-w-[16rem] truncate", last && "font-medium text-ink")} aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <Icon.ChevronRight className="size-3.5 shrink-0 text-ink-faint rtl:rotate-180" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Question type & marks badges                                         */
/* ------------------------------------------------------------------ */

export function QuestionTypeIcon({ type, className }: { type: UiQuestionType; className?: string }) {
  const cls = cn("size-3.5", className);
  switch (type) {
    case "single":
      return <Icon.CircleDot className={cls} />;
    case "multiple":
      return <QuizIcon.SquareCheck className={cls} />;
    case "user_input":
      return <QuizIcon.TextCursor className={cls} />;
    default:
      return <QuizIcon.AlignLeft className={cls} />;
  }
}

export function QuestionTypeBadge({ type, className }: { type: UiQuestionType; className?: string }) {
  const t = useT("learning");
  return (
    <Badge tone="neutral" className={className}>
      <QuestionTypeIcon type={type} />
      {t(`global.quiz.type.${type}`)}
    </Badge>
  );
}

export function MarksBadge({ marks, className }: { marks: number; className?: string }) {
  const t = useT("learning");
  return (
    <Badge tone="neutral" className={className}>
      {t("global.quiz.marks", { count: Number(formatScore(marks)) })}
    </Badge>
  );
}

const statusTone: Record<SubmissionStatus, BadgeTone> = { passed: "success", failed: "danger", pending: "warning" };

export function SubmissionStatusBadge({ status, className }: { status: SubmissionStatus; className?: string }) {
  const t = useT("learning");
  return (
    <Badge tone={statusTone[status]} dot className={className}>
      {t(`global.quiz.status.${status}`)}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Notices                                                              */
/* ------------------------------------------------------------------ */

const noticeTones = {
  info: "border-info/30 bg-info/8 text-ink",
  warning: "border-warning/35 bg-warning/10 text-ink",
  danger: "border-danger/30 bg-danger/8 text-ink",
  success: "border-success/30 bg-success/8 text-ink",
} as const;

const noticeIcons = {
  info: <Icon.Info className="size-4.5 text-info" />,
  warning: <Icon.AlertTriangle className="size-4.5 text-warning" />,
  danger: <Icon.AlertCircle className="size-4.5 text-danger" />,
  success: <Icon.CheckCircle className="size-4.5 text-success" />,
};

export function Notice({
  tone = "info",
  title,
  children,
  icon,
  action,
  className,
  role,
}: {
  tone?: keyof typeof noticeTones;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div role={role} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", noticeTones[tone], className)}>
      <span className="mt-0.5 shrink-0">{icon ?? noticeIcons[tone]}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className={cn("text-ink-muted", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Small uppercase label used above values in summaries. */
export function Stat({ label, value, tone, className }: { label: string; value: ReactNode; tone?: "danger" | "success" | "warning"; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-lg font-semibold tabular-nums",
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-ink",
        )}
      >
        {value}
      </p>
    </div>
  );
}

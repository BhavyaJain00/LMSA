"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

function encouragement(streak: number) {
  if (streak < 1) return "dashboard.streak.leadLow" as const;
  if (streak < 10) return "dashboard.streak.leadMid" as const;
  return "dashboard.streak.leadHigh" as const;
}

/**
 * Amber streak pill next to the greeting. Opens the "Learning Consistency"
 * dialog with current and longest streaks.
 */
export function StreakWidget({
  current,
  longest,
  activeToday,
  className,
}: {
  current: number;
  longest: number;
  activeToday: boolean;
  className?: string;
}) {
  const t = useT("account");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("dashboard.streak.open", { count: current })}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-sm font-semibold text-warning transition-colors hover:bg-warning/25",
          className,
        )}
      >
        <span aria-hidden="true">🔥</span>
        <span className="tabular-nums">{current}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("dashboard.streak.title")} size="sm">
        <div className="flex flex-col items-center text-center">
          <span className="text-[30px] leading-none" aria-hidden="true">
            🔥
          </span>
          <p className="mt-3 text-sm text-ink-muted">{t(encouragement(current))}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{t("dashboard.streak.big", { count: current })}</p>
          {!activeToday && current > 0 && (
            <p className="mt-2 text-xs text-warning">{t("dashboard.streak.keepAlive")}</p>
          )}
          {activeToday && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-success">
              <Icon.CheckCircle className="size-3.5" /> {t("dashboard.streak.doneToday")}
            </p>
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 divide-x divide-border rtl:divide-x-reverse rounded-xl bg-surface-2 py-3 text-center">
          <div>
            <p className="text-xs text-ink-muted">{t("dashboard.streak.current")}</p>
            <p className="mt-0.5 text-base font-semibold text-ink">{t("count.days", { count: current })}</p>
          </div>
          <div>
            <p className="text-xs text-ink-muted">{t("dashboard.streak.longest")}</p>
            <p className="mt-0.5 text-base font-semibold text-ink">{t("count.days", { count: longest })}</p>
          </div>
        </div>
        <p className="mt-4 rounded-lg border border-border px-3 py-2 text-xs leading-relaxed text-ink-muted">
          {t("dashboard.streak.explain")}
        </p>
      </Dialog>
    </>
  );
}

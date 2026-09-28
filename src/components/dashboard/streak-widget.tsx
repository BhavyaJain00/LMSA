"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

function encouragement(streak: number): string {
  if (streak < 1) return "You can do better,";
  if (streak < 10) return "Keep going,";
  return "You rock,";
}

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View learning streak: ${days(current)}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-sm font-semibold text-warning transition-colors hover:bg-warning/25",
          className,
        )}
      >
        <span aria-hidden="true">🔥</span>
        <span className="tabular-nums">{current}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Learning Consistency" size="sm">
        <div className="flex flex-col items-center text-center">
          <span className="text-[30px] leading-none" aria-hidden="true">
            🔥
          </span>
          <p className="mt-3 text-sm text-ink-muted">
            {encouragement(current)} you are on a
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{current} day streak</p>
          {!activeToday && current > 0 && (
            <p className="mt-2 text-xs text-warning">Learn something today to keep your streak alive.</p>
          )}
          {activeToday && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-success">
              <Icon.CheckCircle className="size-3.5" /> You have already learned today.
            </p>
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 divide-x divide-border rounded-xl bg-surface-2 py-3 text-center">
          <div>
            <p className="text-xs text-ink-muted">Current Streak</p>
            <p className="mt-0.5 text-base font-semibold text-ink">{days(current)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-muted">Longest Streak</p>
            <p className="mt-0.5 text-base font-semibold text-ink">{days(longest)}</p>
          </div>
        </div>
        <p className="mt-4 rounded-lg border border-border px-3 py-2 text-xs leading-relaxed text-ink-muted">
          Your learning streak counts the number of days in a row you have kept up your learning, whether it is a lesson, quiz, or
          assignment. Any learning activity during the day keeps it going.
        </p>
      </Dialog>
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import type { RecalculateResult } from "@/lib/services/points";
import { recalculatePointsAction } from "@/lib/actions/gamification";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatPoints, formatSignedPoints } from "../levels";
import { REASON_META } from "../reasons";

/** "Recalculate points from history" with confirmation and a result summary. */
export function RecalculatePoints({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RecalculateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    startTransition(async () => {
      const res = await recalculatePointsAction();
      setOpen(false);
      if (res.ok) {
        setResult(res.data);
        setError(null);
        toast.success(res.message ?? "Points recalculated");
      } else {
        setError(res.error);
        toast.error(res.error);
      }
    });
  };

  return (
    <section className="rounded-card border border-border bg-surface-1 shadow-card" aria-labelledby="recalculate-title">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h3 id="recalculate-title" className="text-base font-semibold text-ink">
            Recalculate points from history
          </h3>
          <p className="mt-0.5 max-w-xl text-sm text-ink-muted">
            Rebuilds every member&apos;s points from completed lessons, quizzes, assignments, exercises, certificates, reviews, discussion replies and learning days,
            using the current values above. Manual adjustments are kept.
          </p>
          {!enabled && <p className="mt-2 text-xs text-warning">Turn on points and save before recalculating.</p>}
        </div>
        <Button variant="outline" onClick={() => setOpen(true)} disabled={!enabled || pending} loading={pending} leftIcon={<Icon.Refresh className="size-4" />}>
          Recalculate
        </Button>
      </div>

      {error && (
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <FormError message={error} />
        </div>
      )}

      {result && (
        <div className="border-t border-border px-4 py-4 sm:px-5" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <Icon.CheckCircle className="size-4" />
            Ledger rebuilt
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Entries", value: formatPoints(result.entries), hint: `${formatPoints(result.previousEntries)} before` },
              { label: "Members", value: formatPoints(result.members) },
              { label: "Points", value: formatPoints(result.totalPoints) },
              { label: "Manual kept", value: formatPoints(result.manualKept) },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-surface-2 p-3">
                <dt className="text-xs text-ink-muted">{s.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{s.value}</dd>
                {s.hint && <dd className="text-[11px] text-ink-faint">{s.hint}</dd>}
              </div>
            ))}
          </dl>
          {result.byReason.length > 0 && (
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {result.byReason.map((r) => (
                <li key={r.reason} className="flex items-center justify-between gap-2 border-b border-dashed border-border py-1 last:border-b-0">
                  <span className="truncate text-ink-muted">
                    {REASON_META[r.reason].label} <span className="text-ink-faint">×{formatPoints(r.count)}</span>
                  </span>
                  <span className="font-medium tabular-nums text-ink">{formatSignedPoints(r.points)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        onConfirm={run}
        loading={pending}
        title="Recalculate all points?"
        description="Every member's points are rebuilt from their learning history with the current point values. Ranks may change. Manual adjustments are kept."
        confirmLabel="Recalculate"
      />
    </section>
  );
}

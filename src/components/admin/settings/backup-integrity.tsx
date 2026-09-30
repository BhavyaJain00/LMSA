"use client";

import { checkIntegrityAction } from "@/app/(app)/admin/settings/data/actions";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/utils";
import { useFormAction } from "./use-form-action";

/**
 * Runs the storage's integrity check on demand and shows the outcome.
 * "Quick" is what the server runs at every start; "full" also verifies the
 * indexes and takes longer on a large database.
 */
export function BackupIntegrity({ driver }: { driver: "sqlite" | "json" }) {
  const { state, pending, submit } = useFormAction(checkIntegrityAction, { toastSuccess: false });
  const report = state?.ok ? state.data : null;

  const run = (mode: "quick" | "full") => {
    const formData = new FormData();
    formData.set("mode", mode);
    submit(formData);
  };

  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 sm:max-w-md">
          <p className="text-sm font-medium text-ink">Integrity check</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            {driver === "sqlite"
              ? "Asks SQLite to verify the database file. The quick check also runs every time the server starts; the full check verifies the indexes too and takes longer on a large database."
              : "Reads the JSON database file back from disk and checks that it can be parsed."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" loading={pending} leftIcon={<Icon.ShieldCheck className="size-4" />} onClick={() => run("quick")}>
            {driver === "sqlite" ? "Quick check" : "Check file"}
          </Button>
          {driver === "sqlite" && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run("full")}>
              Full check
            </Button>
          )}
        </div>
      </div>

      <div aria-live="polite">
        {report?.ok && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-ink">
            <Icon.CheckCircle className="size-4 shrink-0 text-success" />
            <span>
              No problems found ({report.mode === "full" ? "full" : "quick"} check, {formatNumber(report.ms)} ms).
            </span>
          </p>
        )}
        {report && !report.ok && (
          <div role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
            <p className="flex items-center gap-2 font-medium">
              <Icon.AlertCircle className="size-4 shrink-0" />
              The check found problems
            </p>
            <ul className="mt-1 list-disc space-y-0.5 break-words pl-5">
              {report.messages.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
            <p className="mt-2 text-ink">
              Download the current data if that still works, then restore the most recent backup from the list above. If the site no longer starts, stop it and run{" "}
              <code className="rounded bg-surface-2 px-1 font-mono text-[13px]">npm run db:restore -- latest</code> on the server.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

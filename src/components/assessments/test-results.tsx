"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/client";
import type { RunnerTestCase, TestResultView } from "./shared";

function OutputBox({ label, value, tone }: { label: string; value: string | undefined; tone?: "danger" | "success" }) {
  const t = useT("learning");
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <pre
        className={cn(
          "scrollbar-thin max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink",
          tone === "danger" ? "border-danger/30" : tone === "success" ? "border-success/30" : "border-border",
        )}
      >
        {value === undefined || value === "" ? <span className="italic text-ink-faint">{t("exercise.tests.empty")}</span> : value}
      </pre>
    </div>
  );
}

/** Summary line + per-test rows. Hidden tests only show pass/fail unless `revealHidden`. */
export function TestResultsList({
  results,
  tests,
  running = false,
  revealHidden = false,
  emptyText,
  className,
}: {
  results: TestResultView[] | null;
  tests?: RunnerTestCase[];
  running?: boolean;
  revealHidden?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const t = useT("learning");
  const pendingCount = results?.filter((r) => r.pending).length ?? 0;
  const total = (tests?.length ?? results?.length ?? 0) - pendingCount;
  const passed = results?.filter((r) => r.passed).length ?? 0;
  const skipped = results?.every((r) => r.skipped) ?? false;

  return (
    <section className={cn("space-y-3", className)} aria-live="polite" aria-busy={running || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{t("exercise.tests.title")}</h3>
        {results && results.length > 0 && !skipped && (
          <div className="flex flex-wrap items-center gap-1.5">
            {total > 0 && (
              <Badge tone={passed === total ? "success" : "danger"} dot>
                {t("exercise.tests.passedOf", { passed, total })}
              </Badge>
            )}
            {pendingCount > 0 && (
              <Badge tone="neutral" dot>
                {t("exercise.tests.pendingCount", { count: pendingCount })}
              </Badge>
            )}
          </div>
        )}
      </div>

      {!results || results.length === 0 ? (
        <>
          <p className="text-sm text-ink-muted">{running ? t("exercise.tests.running") : (emptyText ?? t("exercise.runToSee"))}</p>
          {tests && tests.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {tests.map((test) => (
                <li key={test.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-sm font-medium text-ink">
                    {t("exercise.tests.test", { number: test.index })}
                    {test.hidden && (
                      <Badge tone="neutral" size="xs" className="ms-2 align-middle">
                        {t("exercise.tests.hidden")}
                      </Badge>
                    )}
                  </p>
                  {(!test.hidden || revealHidden) && (
                    <div className="grid min-w-0 flex-1 gap-2 sm:max-w-md sm:grid-cols-2">
                      {test.input !== undefined && test.input !== "" && <OutputBox label={t("exercise.tests.input")} value={test.input} />}
                      <OutputBox label={t("exercise.tests.expected")} value={test.expectedOutput} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {results.map((r) => {
            const showDetails = !r.hidden || revealHidden;
            return (
              <li key={r.testCaseId} className="space-y-2.5 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    {r.skipped || r.pending ? (
                      <Icon.Clock className="size-4 text-ink-faint" />
                    ) : r.passed ? (
                      <Icon.CheckCircle className="size-4 text-success" />
                    ) : (
                      <Icon.XCircle className="size-4 text-danger" />
                    )}
                    <span>
                      {t.rich("exercise.tests.result", {
                        number: r.index,
                        outcome: r.pending ? (
                          <span className="text-ink-muted">{t("exercise.tests.checkedOnSubmit")}</span>
                        ) : r.skipped ? (
                          <span className="text-ink-muted">{t("exercise.tests.notRun")}</span>
                        ) : (
                          <span className={r.passed ? "text-success" : "text-danger"}>{r.passed ? t("global.assess.passed") : t("global.assess.failed")}</span>
                        ),
                      })}
                    </span>
                    {r.hidden && (
                      <Badge tone="neutral" size="xs">
                        {t("exercise.tests.hidden")}
                      </Badge>
                    )}
                  </p>
                  {typeof r.durationMs === "number" && <span className="text-xs text-ink-faint">{t("exercise.tests.ms", { ms: r.durationMs })}</span>}
                </div>
                {showDetails && !r.skipped && !r.pending && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {r.input !== undefined && r.input !== "" && <OutputBox label={t("exercise.tests.input")} value={r.input} />}
                    <OutputBox label={t("exercise.tests.yourOutput")} value={r.actualOutput} tone={r.passed ? "success" : "danger"} />
                    <OutputBox label={t("exercise.tests.expected")} value={r.expectedOutput} />
                  </div>
                )}
                {r.error && (showDetails || !r.hidden) && (
                  <p className="whitespace-pre-wrap break-words rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 font-mono text-xs text-danger">{r.error}</p>
                )}
                {r.error && r.hidden && !revealHidden && !r.skipped && <p className="text-xs text-danger">{t("exercise.tests.hiddenError")}</p>}
                {showDetails && r.logs && r.logs.length > 0 && (
                  <details className="rounded-lg border border-border bg-surface-2/60 px-2.5 py-1.5 text-xs">
                    <summary className="cursor-pointer select-none text-ink-muted">{t("exercise.tests.console", { count: r.logs.length })}</summary>
                    <pre className="scrollbar-thin mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-ink">{r.logs.join("\n")}</pre>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

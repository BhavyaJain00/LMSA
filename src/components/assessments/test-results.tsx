import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import type { RunnerTestCase, TestResultView } from "./shared";

function OutputBox({ label, value, tone }: { label: string; value: string | undefined; tone?: "danger" | "success" }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <pre
        className={cn(
          "scrollbar-thin max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink",
          tone === "danger" ? "border-danger/30" : tone === "success" ? "border-success/30" : "border-border",
        )}
      >
        {value === undefined || value === "" ? <span className="italic text-ink-faint">(empty)</span> : value}
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
  emptyText = "Please run the code to execute the test cases.",
  className,
}: {
  results: TestResultView[] | null;
  tests?: RunnerTestCase[];
  running?: boolean;
  revealHidden?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const total = tests?.length ?? results?.length ?? 0;
  const passed = results?.filter((r) => r.passed).length ?? 0;
  const skipped = results?.every((r) => r.skipped) ?? false;

  return (
    <section className={cn("space-y-3", className)} aria-live="polite" aria-busy={running || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Test Cases</h3>
        {results && results.length > 0 && !skipped && (
          <Badge tone={passed === total && total > 0 ? "success" : "danger"} dot>
            {passed} of {total} passed
          </Badge>
        )}
      </div>

      {!results || results.length === 0 ? (
        <>
          <p className="text-sm text-ink-muted">{running ? "Running your code…" : emptyText}</p>
          {tests && tests.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {tests.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-sm font-medium text-ink">
                    Test {t.index}
                    {t.hidden && (
                      <Badge tone="neutral" size="xs" className="ml-2 align-middle">
                        Hidden
                      </Badge>
                    )}
                  </p>
                  {(!t.hidden || revealHidden) && (
                    <div className="grid min-w-0 flex-1 gap-2 sm:max-w-md sm:grid-cols-2">
                      {t.input !== "" && <OutputBox label="Input" value={t.input} />}
                      <OutputBox label="Expected Output" value={t.expectedOutput} />
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
                    {r.skipped ? (
                      <Icon.Clock className="size-4 text-ink-faint" />
                    ) : r.passed ? (
                      <Icon.CheckCircle className="size-4 text-success" />
                    ) : (
                      <Icon.XCircle className="size-4 text-danger" />
                    )}
                    <span>
                      Test {r.index} -{" "}
                      {r.skipped ? (
                        <span className="text-ink-muted">Not run</span>
                      ) : (
                        <span className={r.passed ? "text-success" : "text-danger"}>{r.passed ? "Passed" : "Failed"}</span>
                      )}
                    </span>
                    {r.hidden && (
                      <Badge tone="neutral" size="xs">
                        Hidden
                      </Badge>
                    )}
                  </p>
                  {typeof r.durationMs === "number" && <span className="text-xs text-ink-faint">{r.durationMs} ms</span>}
                </div>
                {showDetails && !r.skipped && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {r.input !== undefined && r.input !== "" && <OutputBox label="Input" value={r.input} />}
                    <OutputBox label="Your Output" value={r.actualOutput} tone={r.passed ? "success" : "danger"} />
                    <OutputBox label="Expected Output" value={r.expectedOutput} />
                  </div>
                )}
                {r.error && (showDetails || !r.hidden) && (
                  <p className="whitespace-pre-wrap break-words rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 font-mono text-xs text-danger">{r.error}</p>
                )}
                {r.error && r.hidden && !revealHidden && !r.skipped && <p className="text-xs text-danger">This hidden test raised an error.</p>}
                {showDetails && r.logs && r.logs.length > 0 && (
                  <details className="rounded-lg border border-border bg-surface-2/60 px-2.5 py-1.5 text-xs">
                    <summary className="cursor-pointer select-none text-ink-muted">Console output ({r.logs.length})</summary>
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

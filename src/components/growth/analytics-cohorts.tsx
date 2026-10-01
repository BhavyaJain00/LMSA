import type { CohortRow } from "@/lib/growth/analytics-metrics";
import { formatDate } from "@/lib/utils";

/**
 * Weekly sign-up cohorts × weeks since sign-up, shaded by the share of the
 * cohort that was active. Only the table scrolls sideways on small screens.
 */
export function AnalyticsCohorts({ rows }: { rows: CohortRow[] }) {
  const weeks = rows[0]?.cells.length ?? 0;
  return (
    <div className="overflow-x-auto rounded-lg border border-border scrollbar-thin">
      <table className="w-full min-w-[36rem] text-xs">
        <caption className="sr-only">Share of each weekly sign-up cohort active in the weeks after signing up</caption>
        <thead className="bg-surface-2 text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Signed up (week of)
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Members
            </th>
            {Array.from({ length: weeks }, (_, i) => (
              <th key={i} scope="col" className="px-1 py-2 text-center font-medium">
                <abbr title={`Week ${i + 1} after sign-up`} className="no-underline">
                  W{i + 1}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.week}>
              <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-ink">
                {formatDate(row.week, { year: undefined })}
              </th>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{row.size}</td>
              {row.cells.map((value, i) => (
                <td key={i} className="p-0.5 text-center">
                  {value === null ? (
                    <span className="block rounded px-1 py-1 text-ink-faint" title="Not reached yet">
                      ·
                    </span>
                  ) : (
                    <span
                      className="block rounded px-1 py-1 tabular-nums"
                      style={{
                        background: `color-mix(in oklab, var(--accent) ${Math.round(Math.min(100, value) * 0.8)}%, var(--surface-2))`,
                        color: value >= 55 ? "var(--surface-1)" : "var(--ink)",
                      }}
                    >
                      {Math.round(value)}%
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

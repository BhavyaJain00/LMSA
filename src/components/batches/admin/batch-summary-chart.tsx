import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import type { ChartDatum } from "../types";

const kindIcon: Record<ChartDatum["kind"], ReactNode> = {
  course: <Icon.BookOpen />,
  quiz: <Icon.ListChecks />,
  assignment: <Icon.ClipboardList />,
  exercise: <Icon.Code />,
};

const kindVerb: Record<ChartDatum["kind"], string> = {
  course: "completed",
  quiz: "passed",
  assignment: "passed",
  exercise: "passed",
};

/**
 * "Batch Summary": number of students who completed each course or passed
 * each assessment. Single-series horizontal bars, directly labeled, scaled to
 * the number of enrolled students.
 */
export function BatchSummaryChart({ data, studentCount }: { data: ChartDatum[]; studentCount: number }) {
  const max = Math.max(1, studentCount);
  return (
    <Card>
      <CardHeader title="Batch Summary" description="How learners are doing across courses and assessments" />
      <CardBody>
        {data.length === 0 || studentCount === 0 ? (
          <p className="text-sm text-ink-muted">
            {studentCount === 0 ? "The summary appears once students are enrolled." : "Add courses or assessments to see how the cohort is doing."}
          </p>
        ) : (
          <figure>
            <ul className="space-y-3.5" aria-label="Number of students per task">
              {data.map((d, i) => {
                const pct = Math.round((d.value / max) * 100);
                return (
                  <li key={`${d.kind}-${i}`} className="group" title={`${d.label}: ${d.value} of ${studentCount} students ${kindVerb[d.kind]}`}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5 text-ink">
                        <span className="shrink-0 text-ink-faint [&>svg]:size-3.5" aria-hidden="true">
                          {kindIcon[d.kind]}
                        </span>
                        <span className="truncate">{d.label}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        <span className="font-semibold text-ink">{d.value}</span>/{studentCount} {kindVerb[d.kind]}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent transition-[width,filter] duration-500 group-hover:brightness-110"
                        style={{ width: d.value > 0 ? `max(${pct}%, 0.5rem)` : "0" }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <figcaption className="mt-4 text-xs text-ink-faint">Bars are scaled to the {studentCount} enrolled student{studentCount === 1 ? "" : "s"}.</figcaption>
          </figure>
        )}
      </CardBody>
    </Card>
  );
}

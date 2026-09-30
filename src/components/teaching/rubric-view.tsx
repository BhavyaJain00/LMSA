import type { Rubric, RubricScore } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { criterionMaxPoints, formatPoints, meetsThreshold, pointsToPass, rubricMaxPoints, scorePercent, totalOfScores } from "@/lib/teaching/rubric-shared";

/**
 * Read-only rubric: every criterion with its levels. With `scores`, the
 * chosen level of each criterion is highlighted with its points and the
 * grader's comment, and a total line shows the result against the pass mark.
 * No hooks, so it renders on the server and inside client components alike.
 */
export function RubricView({
  rubric,
  scores,
  showTotal = true,
  className,
  headingLevel = 3,
}: {
  rubric: Pick<Rubric, "criteria" | "passPercent">;
  scores?: readonly RubricScore[];
  showTotal?: boolean;
  className?: string;
  headingLevel?: 3 | 4;
}) {
  const scored = !!scores?.length;
  const byCriterion = new Map((scores ?? []).map((s) => [s.criterionId, s]));
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const known = new Set(rubric.criteria.map((c) => c.id));
  const orphaned = (scores ?? []).filter((s) => !known.has(s.criterionId));

  return (
    <div className={cn("space-y-3", className)}>
      {rubric.criteria.map((criterion) => {
        const score = byCriterion.get(criterion.id);
        const max = criterionMaxPoints(criterion);
        return (
          <section key={criterion.id} className="rounded-xl border border-border bg-surface-1 p-3 sm:p-4" aria-label={criterion.title}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Heading className="font-medium text-ink">{criterion.title}</Heading>
                {criterion.description && <p className="mt-0.5 text-sm text-ink-muted">{criterion.description}</p>}
              </div>
              {scored ? (
                <Badge tone={score ? "accent" : "neutral"}>{score ? `${formatPoints(score.points)} / ${formatPoints(max)} pts` : "Not scored"}</Badge>
              ) : (
                <Badge tone="outline">Up to {formatPoints(max)} pts</Badge>
              )}
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {criterion.levels.map((level, i) => {
                const chosen = score?.levelIndex === i;
                return (
                  <li
                    key={i}
                    className={cn(
                      "relative rounded-lg border px-3 py-2 text-sm",
                      chosen ? "border-accent bg-accent/8 ring-1 ring-accent/40" : "border-border bg-surface-2/40",
                      scored && !chosen && "opacity-70",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">
                        {chosen && <Icon.Check className="mr-1 inline size-3.5 text-accent" aria-hidden="true" />}
                        {level.label}
                        {chosen && <span className="sr-only"> (selected)</span>}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">{formatPoints(level.points)} pts</span>
                    </div>
                    {level.description && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{level.description}</p>}
                  </li>
                );
              })}
            </ul>
            {score?.comment && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
                <Icon.MessageSquare className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
                <span className="min-w-0 whitespace-pre-line break-words">{score.comment}</span>
              </p>
            )}
          </section>
        );
      })}
      {orphaned.length > 0 && (
        <p className="text-xs text-ink-muted">
          {orphaned.length === 1 ? "One scored criterion was" : `${orphaned.length} scored criteria were`} later removed from the rubric; their points still count toward the total.
        </p>
      )}
      {showTotal && <RubricTotal rubric={rubric} scores={scores} />}
    </div>
  );
}

/** "Total 14 / 20 pts (70%) · Pass mark 60%" line, with a pass/fail chip once scored. */
export function RubricTotal({ rubric, scores, className }: { rubric: Pick<Rubric, "criteria" | "passPercent">; scores?: readonly RubricScore[]; className?: string }) {
  const max = rubricMaxPoints(rubric);
  const scored = !!scores?.length;
  const total = totalOfScores(scores);
  const complete = scored && rubric.criteria.every((c) => scores!.some((s) => s.criterionId === c.id));
  const passed = complete && meetsThreshold(total, max, rubric.passPercent);
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm", className)}>
      <p className="text-ink">
        {scored ? (
          <>
            <span className="font-semibold tabular-nums">
              {formatPoints(total)} / {formatPoints(max)} pts
            </span>
            <span className="text-ink-muted"> ({scorePercent(total, max)}%)</span>
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums">{formatPoints(max)} pts</span>
            <span className="text-ink-muted"> available</span>
          </>
        )}
      </p>
      <p className="flex items-center gap-2 text-ink-muted">
        Pass mark {rubric.passPercent}% ({formatPoints(pointsToPass(max, rubric.passPercent))} pts)
        {complete && (
          <Badge tone={passed ? "success" : "danger"} dot>
            {passed ? "Meets the pass mark" : "Below the pass mark"}
          </Badge>
        )}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { gradeSubmissionAction } from "@/lib/actions/quiz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { ResultBreakdown } from "./result-breakdown";
import { formatPercent, formatScore, type ResultDetail } from "./types";

function gradable(row: ResultDetail): boolean {
  return row.type === "open_ended" && row.answered;
}

function initialMarks(rows: ResultDetail[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) if (gradable(row)) out[row.questionId] = row.graded && row.marks !== undefined ? String(row.marks) : "";
  return out;
}

type Translate = ReturnType<typeof useT<"learning">>;

function validate(value: string, max: number, t: Translate): string | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return t("quizAdmin.grading.notNegative");
  if (n > max) return t("quizAdmin.grading.tooHigh", { max: formatScore(max) });
  return null;
}

/**
 * Grading controls for a submission: a marks input per open-ended answer,
 * a live score preview, "Not saved" state, Save button and Ctrl/Cmd+S.
 */
export function GradingForm({ submissionId, rows, passingPercentage }: { submissionId: string; rows: ResultDetail[]; passingPercentage: number }) {
  const { toast } = useToast();
  const t = useT("learning");
  const [saved, setSaved] = useState<Record<string, string>>(() => initialMarks(rows));
  const [marks, setMarks] = useState<Record<string, string>>(() => initialMarks(rows));
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const gradableRows = useMemo(() => rows.filter(gradable), [rows]);
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of gradableRows) {
      const err = validate(marks[row.questionId] ?? "", row.marksOutOf, t);
      if (err) out[row.questionId] = err;
    }
    return out;
  }, [gradableRows, marks, t]);
  const dirty = gradableRows.some((r) => (marks[r.questionId] ?? "") !== (saved[r.questionId] ?? ""));
  const valid = Object.keys(errors).length === 0;
  const ungraded = gradableRows.filter((r) => (marks[r.questionId] ?? "").trim() === "").length;

  const preview = useMemo(() => {
    let score = 0;
    let outOf = 0;
    for (const row of rows) {
      outOf += row.marksOutOf;
      if (gradable(row)) {
        const n = Number(marks[row.questionId]);
        if ((marks[row.questionId] ?? "").trim() !== "" && Number.isFinite(n)) score += n;
      } else {
        score += row.marks ?? 0;
      }
    }
    const pct = outOf > 0 ? Math.max(0, (score / outOf) * 100) : 0;
    return { score: Math.round(score * 100) / 100, outOf, pct };
  }, [rows, marks]);

  const save = async () => {
    if (saving || !dirty || !valid) return;
    setSaving(true);
    setServerErrors({});
    const payload: Record<string, number> = {};
    for (const row of gradableRows) {
      const v = (marks[row.questionId] ?? "").trim();
      if (v !== "") payload[row.questionId] = Number(v);
    }
    try {
      const res = await gradeSubmissionAction({ submissionId, marks: payload });
      if (res.ok) {
        setSaved(marks);
        toast({
          title: t("quizAdmin.grading.saved"),
          description: res.data.pendingGrading
            ? t("quizAdmin.grading.stillPending")
            : t("quizAdmin.grading.savedScore", { score: formatScore(res.data.score), total: formatScore(res.data.scoreOutOf) }),
          tone: "success",
        });
      } else {
        setServerErrors(res.fieldErrors ?? {});
        toast({ title: res.error, tone: "error" });
      }
    } catch {
      toast({ title: t("quizAdmin.grading.saveFailed"), tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S saves; warn before leaving with unsaved marks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        document.getElementById(`grade-save-${submissionId}`)?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submissionId]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <div>
      {gradableRows.length > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-1/95 px-4 py-3 backdrop-blur sm:px-5">
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">
              {t("quizAdmin.grading.scoreAfter", { score: formatScore(preview.score), total: formatScore(preview.outOf) })}{" "}
              <span className="text-ink-muted">({formatPercent(preview.pct)})</span>
            </p>
            <p className="text-xs text-ink-muted">
              {ungraded > 0
                ? t("quizAdmin.grading.needMarks", { count: ungraded, percent: formatScore(passingPercentage) })
                : preview.pct >= passingPercentage
                  ? t("quizAdmin.grading.willPass")
                  : t("quizAdmin.grading.belowPass", { percent: formatScore(passingPercentage) })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <Badge tone="warning" dot>
                {t("quizAdmin.grading.notSaved")}
              </Badge>
            )}
            <Button
              id={`grade-save-${submissionId}`}
              onClick={() => void save()}
              loading={saving}
              disabled={!dirty || !valid}
              leftIcon={<Icon.Check className="size-4" />}
              title={t("quizAdmin.grading.saveShortcut")}
            >
              {t("quizAdmin.grading.save")}
            </Button>
          </div>
        </div>
      )}
      <ResultBreakdown
        rows={rows}
        revealed
        renderMarks={(row) => {
          if (!gradable(row)) return undefined;
          const id = `marks-${row.questionId}`;
          const error = errors[row.questionId] ?? serverErrors[row.questionId];
          return (
            <div className="flex flex-col items-start gap-1 lg:items-end">
              <div className="flex items-center gap-2">
                <label htmlFor={id} className="sr-only">
                  {t("quizAdmin.grading.marksFor", { number: row.index })}
                </label>
                <input
                  id={id}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={row.marksOutOf}
                  step="0.5"
                  value={marks[row.questionId] ?? ""}
                  placeholder="–"
                  onChange={(e) => setMarks((prev) => ({ ...prev, [row.questionId]: e.target.value }))}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-err` : undefined}
                  className={cn(
                    "h-9 w-20 rounded-lg border bg-surface-1 px-2 text-end text-sm tabular-nums text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
                    error ? "border-danger" : "border-border-strong",
                  )}
                />
                <span className="text-sm text-ink-muted">/ {formatScore(row.marksOutOf)}</span>
              </div>
              {error ? (
                <p id={`${id}-err`} className="max-w-48 text-xs text-danger lg:text-end">
                  {error}
                </p>
              ) : (marks[row.questionId] ?? "") === "" ? (
                <Badge tone="warning">{t("quiz.breakdown.awaiting")}</Badge>
              ) : null}
            </div>
          );
        }}
      />
    </div>
  );
}

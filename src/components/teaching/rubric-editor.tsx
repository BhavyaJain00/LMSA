"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult, RubricCriterion } from "@/lib/types";
import { uid } from "@/lib/utils";
import { saveRubricAction } from "@/lib/actions/rubrics";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { submitWithoutReset } from "@/components/assessments/form-submit";
import { NotSavedBadge } from "@/components/assessments/status-badges";
import { RUBRIC_LIMITS, formatPoints, pointsToPass, roundPoints } from "@/lib/teaching/rubric-shared";
import { RubricView } from "./rubric-view";

interface DraftLevel {
  key: string;
  label: string;
  points: string;
  description: string;
}

interface DraftCriterion {
  key: string;
  /** Saved criterion id (kept so existing scores still match), or "" for a new row. */
  id: string;
  title: string;
  description: string;
  levels: DraftLevel[];
}

export interface RubricEditorValues {
  id?: string;
  title: string;
  passPercent: number;
  criteria: Omit<RubricCriterion, "id">[] | RubricCriterion[];
}

/** Key for a row added in the browser. Rows of the first render use position-based keys so server and client markup match. */
const key = () => uid("k");

function toDraft(criteria: RubricEditorValues["criteria"]): DraftCriterion[] {
  return criteria.map((c, ci) => ({
    key: `init-${ci}`,
    id: "id" in c ? c.id : "",
    title: c.title,
    description: c.description ?? "",
    levels: c.levels.map((l, li) => ({ key: `init-${ci}-${li}`, label: l.label, points: String(l.points), description: l.description ?? "" })),
  }));
}

function blankCriterion(template?: DraftCriterion, rowKey: string = key()): DraftCriterion {
  const levels = template
    ? template.levels.map((l) => ({ label: l.label, points: l.points }))
    : [
        { label: "Needs work", points: "1" },
        { label: "Good", points: "2" },
        { label: "Excellent", points: "3" },
      ];
  return {
    key: rowKey,
    id: "",
    title: "",
    description: "",
    levels: levels.map((l, li) => ({ ...l, key: `${rowKey}-${li}`, description: "" })),
  };
}

function pointsOf(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Criteria × levels grid editor. Points are totalled live (each criterion is
 * worth its best level), the pass mark shows the points needed, and a
 * preview renders the rubric exactly as learners and graders see it.
 */
export function RubricEditor({ initial, canEdit, gradedCount = 0 }: { initial: RubricEditorValues; canEdit: boolean; gradedCount?: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState(initial.title);
  const [passPercent, setPassPercent] = useState(String(initial.passPercent));
  const [criteria, setCriteria] = useState<DraftCriterion[]>(() => (initial.criteria.length ? toDraft(initial.criteria) : [blankCriterion(undefined, "init-0")]));
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [openDescriptions, setOpenDescriptions] = useState<Set<string>>(() => new Set());
  const lastAdded = useRef<string | null>(null);

  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(async (prev, formData) => {
    const res = await saveRubricAction(prev, formData);
    if (res.ok) {
      setDirty(false);
      toast({ title: res.message ?? "Rubric saved", tone: "success" });
      router.refresh();
    } else {
      toast({ title: res.error, tone: "error" });
    }
    return res;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!lastAdded.current) return;
    document.getElementById(`crit-title-${lastAdded.current}`)?.focus();
    lastAdded.current = null;
  }, [criteria.length]);

  const change = (next: DraftCriterion[]) => {
    setCriteria(next);
    setDirty(true);
  };
  const updateCriterion = (ci: number, patch: Partial<DraftCriterion>) => change(criteria.map((c, i) => (i === ci ? { ...c, ...patch } : c)));
  const updateLevel = (ci: number, li: number, patch: Partial<DraftLevel>) =>
    updateCriterion(ci, { levels: criteria[ci]!.levels.map((l, i) => (i === li ? { ...l, ...patch } : l)) });

  const maxOf = (c: DraftCriterion) => c.levels.reduce((m, l) => Math.max(m, pointsOf(l.points)), 0);
  const totalMax = roundPoints(criteria.reduce((t, c) => t + maxOf(c), 0));
  const pass = Math.min(100, Math.max(0, Number(passPercent) || 0));

  const payload = criteria.map((c) => ({
    id: c.id || undefined,
    title: c.title,
    description: c.description,
    levels: c.levels.map((l) => ({ label: l.label, points: l.points.trim() === "" ? null : Number(l.points), description: l.description })),
  }));

  const preview = {
    passPercent: pass,
    criteria: criteria.map((c, i) => ({
      id: c.id || c.key || String(i),
      title: c.title || `Criterion ${i + 1}`,
      description: c.description || undefined,
      levels: c.levels.map((l, li) => ({ label: l.label || `Level ${li + 1}`, points: pointsOf(l.points), description: l.description || undefined })),
    })),
  };

  const addCriterion = () => {
    const c = blankCriterion(criteria[criteria.length - 1]);
    lastAdded.current = c.key;
    change([...criteria, c]);
  };

  const applyLevelsToAll = (ci: number) => {
    const source = criteria[ci]!;
    change(
      criteria.map((c, i) =>
        i === ci
          ? c
          : {
              ...c,
              levels: source.levels.map((l, li) => ({ key: key(), label: l.label, points: l.points, description: c.levels[li]?.description ?? "" })),
            },
      ),
    );
    toast({ title: "Levels copied to every criterion", tone: "success" });
  };

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-6" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="criteria" value={JSON.stringify(payload)} />
      <FormError message={state && !state.ok && !Object.keys(errors).length ? state.error : null} />
      {!canEdit && (
        <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          <Icon.Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Only the author or a moderator can change this rubric. Duplicate it to adapt your own copy.
        </p>
      )}
      {canEdit && gradedCount > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {gradedCount} graded {gradedCount === 1 ? "submission uses" : "submissions use"} this rubric. Their saved points and pass/fail results stay as they are; changes apply to
          new grading.
        </p>
      )}

      <Card>
        <CardHeader title="Rubric details" actions={dirty ? <NotSavedBadge /> : undefined} />
        <CardBody className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="Title" htmlFor="rubric-title" required error={errors.title}>
            <Input
              id="rubric-title"
              name="title"
              value={title}
              maxLength={RUBRIC_LIMITS.titleMax}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              placeholder="e.g. Capstone project"
              invalid={!!errors.title}
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Pass mark"
            htmlFor="rubric-pass"
            required
            error={errors.passPercent}
            hint={`${formatPoints(pointsToPass(totalMax, pass))} of ${formatPoints(totalMax)} pts`}
          >
            <Input
              id="rubric-pass"
              name="passPercent"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={1}
              value={passPercent}
              onChange={(e) => {
                setPassPercent(e.target.value);
                setDirty(true);
              }}
              rightAddon={<span className="text-sm">%</span>}
              invalid={!!errors.passPercent}
              disabled={!canEdit}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Criteria</h2>
          <p className="text-sm text-ink-muted">
            {criteria.length} {criteria.length === 1 ? "criterion" : "criteria"} · {formatPoints(totalMax)} pts in total
          </p>
        </div>
        <SegmentedControl
          options={[
            { value: "edit", label: "Edit", icon: <Icon.Edit className="size-3.5" /> },
            { value: "preview", label: "Preview", icon: <Icon.Eye className="size-3.5" /> },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {errors.criteria && <p className="text-sm text-danger">{errors.criteria}</p>}

      {mode === "preview" ? (
        <Card className="p-4 sm:p-5">
          <RubricView rubric={preview} />
        </Card>
      ) : (
        <ol className="space-y-4">
          {criteria.map((c, ci) => {
            const base = `criteria.${ci}`;
            const descOpen = openDescriptions.has(c.key) || !!c.description;
            return (
              <li key={c.key}>
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-start gap-3 border-b border-border bg-surface-2/50 px-4 py-3">
                    <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-xs font-semibold text-accent" aria-hidden="true">
                      {ci + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <label htmlFor={`crit-title-${c.key}`} className="sr-only">
                        Criterion {ci + 1} name
                      </label>
                      <Input
                        id={`crit-title-${c.key}`}
                        value={c.title}
                        maxLength={RUBRIC_LIMITS.criterionTitleMax}
                        onChange={(e) => updateCriterion(ci, { title: e.target.value })}
                        placeholder={`Criterion ${ci + 1}, e.g. Clarity`}
                        invalid={!!errors[`${base}.title`]}
                        disabled={!canEdit}
                        className="font-medium"
                      />
                      {errors[`${base}.title`] && <p className="text-xs text-danger">{errors[`${base}.title`]}</p>}
                      {descOpen ? (
                        <>
                          <label htmlFor={`crit-desc-${c.key}`} className="sr-only">
                            Criterion {ci + 1} description
                          </label>
                          <Textarea
                            id={`crit-desc-${c.key}`}
                            rows={2}
                            value={c.description}
                            maxLength={RUBRIC_LIMITS.criterionDescriptionMax}
                            onChange={(e) => updateCriterion(ci, { description: e.target.value })}
                            placeholder="What this criterion looks at (optional)"
                            invalid={!!errors[`${base}.description`]}
                            disabled={!canEdit}
                          />
                        </>
                      ) : (
                        canEdit && (
                          <button
                            type="button"
                            className="text-xs font-medium text-accent hover:underline"
                            onClick={() => setOpenDescriptions((prev) => new Set(prev).add(c.key))}
                          >
                            Add a description
                          </button>
                        )
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge tone="accent" className="mr-1">
                        {formatPoints(maxOf(c))} pts
                      </Badge>
                      {canEdit && (
                        <>
                          <IconButton label={`Move criterion ${ci + 1} up`} size="icon-sm" disabled={ci === 0} onClick={() => change(move(criteria, ci, ci - 1))}>
                            <Icon.ChevronUp className="size-4" />
                          </IconButton>
                          <IconButton
                            label={`Move criterion ${ci + 1} down`}
                            size="icon-sm"
                            disabled={ci === criteria.length - 1}
                            onClick={() => change(move(criteria, ci, ci + 1))}
                          >
                            <Icon.ChevronDown className="size-4" />
                          </IconButton>
                          <IconButton
                            label={`Remove criterion ${ci + 1}`}
                            size="icon-sm"
                            disabled={criteria.length <= RUBRIC_LIMITS.criteriaMin}
                            onClick={() => change(criteria.filter((_, i) => i !== ci))}
                            className="text-danger"
                          >
                            <Icon.Trash className="size-4" />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {c.levels.map((l, li) => {
                        const lBase = `${base}.levels.${li}`;
                        return (
                          <div key={l.key} className="space-y-2 rounded-lg border border-border bg-surface-1 p-3">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Level {li + 1}</span>
                              {canEdit && (
                                <span className="flex items-center">
                                  <IconButton label={`Move level ${li + 1} left`} size="icon-sm" disabled={li === 0} onClick={() => updateCriterion(ci, { levels: move(c.levels, li, li - 1) })}>
                                    <Icon.ChevronLeft className="size-3.5" />
                                  </IconButton>
                                  <IconButton
                                    label={`Move level ${li + 1} right`}
                                    size="icon-sm"
                                    disabled={li === c.levels.length - 1}
                                    onClick={() => updateCriterion(ci, { levels: move(c.levels, li, li + 1) })}
                                  >
                                    <Icon.ChevronRight className="size-3.5" />
                                  </IconButton>
                                  <IconButton
                                    label={`Remove level ${li + 1}`}
                                    size="icon-sm"
                                    disabled={c.levels.length <= RUBRIC_LIMITS.levelsMin}
                                    onClick={() => updateCriterion(ci, { levels: c.levels.filter((_, i) => i !== li) })}
                                  >
                                    <Icon.X className="size-3.5" />
                                  </IconButton>
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                              <div>
                                <label htmlFor={`lvl-label-${l.key}`} className="sr-only">
                                  Level {li + 1} name
                                </label>
                                <Input
                                  id={`lvl-label-${l.key}`}
                                  value={l.label}
                                  maxLength={RUBRIC_LIMITS.levelLabelMax}
                                  onChange={(e) => updateLevel(ci, li, { label: e.target.value })}
                                  placeholder="Name"
                                  invalid={!!errors[`${lBase}.label`]}
                                  disabled={!canEdit}
                                />
                              </div>
                              <div>
                                <label htmlFor={`lvl-points-${l.key}`} className="sr-only">
                                  Level {li + 1} points
                                </label>
                                <Input
                                  id={`lvl-points-${l.key}`}
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  max={RUBRIC_LIMITS.pointsMax}
                                  step={0.5}
                                  value={l.points}
                                  onChange={(e) => updateLevel(ci, li, { points: e.target.value })}
                                  aria-describedby={`lvl-points-unit-${l.key}`}
                                  invalid={!!errors[`${lBase}.points`]}
                                  disabled={!canEdit}
                                />
                                <span id={`lvl-points-unit-${l.key}`} className="sr-only">
                                  points
                                </span>
                              </div>
                            </div>
                            {(errors[`${lBase}.label`] || errors[`${lBase}.points`]) && (
                              <p className="text-xs text-danger">{errors[`${lBase}.label`] ?? errors[`${lBase}.points`]}</p>
                            )}
                            <label htmlFor={`lvl-desc-${l.key}`} className="sr-only">
                              Level {li + 1} description
                            </label>
                            <Textarea
                              id={`lvl-desc-${l.key}`}
                              rows={2}
                              value={l.description}
                              maxLength={RUBRIC_LIMITS.levelDescriptionMax}
                              onChange={(e) => updateLevel(ci, li, { description: e.target.value })}
                              placeholder="What work at this level looks like"
                              invalid={!!errors[`${lBase}.description`]}
                              disabled={!canEdit}
                              className="text-xs"
                            />
                          </div>
                        );
                      })}
                    </div>
                    {errors[`${base}.levels`] && <p className="mt-2 text-xs text-danger">{errors[`${base}.levels`]}</p>}
                    {canEdit && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={c.levels.length >= RUBRIC_LIMITS.levelsMax}
                          onClick={() => {
                            const top = c.levels.reduce((m, lv) => Math.max(m, pointsOf(lv.points)), 0);
                            updateCriterion(ci, { levels: [...c.levels, { key: key(), label: "", points: String(top + 1), description: "" }] });
                          }}
                          leftIcon={<Icon.Plus className="size-3.5" />}
                        >
                          Add level
                        </Button>
                        {criteria.length > 1 && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => applyLevelsToAll(ci)} leftIcon={<Icon.Copy className="size-3.5" />}>
                            Use these levels for all criteria
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {canEdit && mode === "edit" && (
        <Button
          type="button"
          variant="outline"
          className="w-full border-dashed"
          disabled={criteria.length >= RUBRIC_LIMITS.criteriaMax}
          onClick={addCriterion}
          leftIcon={<Icon.Plus className="size-4" />}
        >
          Add criterion
        </Button>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-xl sm:border">
        <p className="text-sm text-ink-muted">
          Max <span className="font-semibold text-ink">{formatPoints(totalMax)} pts</span> · pass at{" "}
          <span className="font-semibold text-ink">{formatPoints(pointsToPass(totalMax, pass))} pts</span>
        </p>
        <div className="flex gap-2">
          <Link href="/admin/rubrics" className="inline-flex h-9.5 items-center rounded-lg px-4 text-sm font-medium text-ink hover:bg-surface-2">
            {canEdit ? "Cancel" : "Back"}
          </Link>
          {canEdit && (
            <Button type="submit" loading={pending} leftIcon={<Icon.Check className="size-4" />}>
              {initial.id ? "Save rubric" : "Create rubric"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

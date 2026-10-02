"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import type { ActionResult, ExerciseLanguage } from "@/lib/types";
import { deleteExercisesAction, saveExerciseAction } from "@/lib/actions/exercises";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, FormError, Input, Select } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { CodeEditor } from "./code-editor";
import { MarkdownEditor } from "./markdown-editor";
import { NotSavedBadge } from "./status-badges";
import { submitWithoutReset } from "./form-submit";
import { DEFAULT_STARTER_CODE, LANGUAGE_OPTIONS, MAX_TEST_CASES, isRunnableLanguage } from "./shared";
import { useT } from "@/i18n/client";

export interface ExerciseFormValues {
  id: string;
  title: string;
  language: ExerciseLanguage;
  courseId?: string;
  problemStatement: string;
  starterCode: string;
  testCases: { id: string; input: string; expectedOutput: string; hidden: boolean }[];
}

interface Row {
  key: string;
  id?: string;
  input: string;
  expectedOutput: string;
  hidden: boolean;
}

let rowCounter = 0;
const newKey = () => `row-${++rowCounter}`;

export function ExerciseFormView({
  exercise,
  courseOptions,
  defaultCourseId,
}: {
  exercise: ExerciseFormValues | null;
  courseOptions: { value: string; label: string }[];
  defaultCourseId?: string;
}) {
  const t = useT("learning");
  const tc = useT("common");
  const router = useRouter();
  const { toast } = useToast();
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(saveExerciseAction, null);
  const [dirty, setDirty] = useState(false);
  const [language, setLanguage] = useState<ExerciseLanguage>(exercise?.language ?? "javascript");
  const [starterCode, setStarterCode] = useState(exercise?.starterCode ?? DEFAULT_STARTER_CODE.javascript);
  const [rows, setRows] = useState<Row[]>(() =>
    exercise?.testCases.length
      ? exercise.testCases.map((tc) => ({ key: newKey(), id: tc.id, input: tc.input, expectedOutput: tc.expectedOutput, hidden: tc.hidden }))
      : [{ key: newKey(), input: "", expectedOutput: "", hidden: false }],
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  const touch = () => setDirty(true);
  const updateRow = (key: string, patch: Partial<Row>) => {
    touch();
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const addRow = () => {
    touch();
    setRows((prev) => [...prev, { key: newKey(), input: "", expectedOutput: "", hidden: false }]);
  };
  const removeRow = (key: string) => {
    touch();
    setRows((prev) => prev.filter((r) => r.key !== key));
  };
  const duplicateRow = (key: string) => {
    touch();
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key);
      if (i === -1) return prev;
      const copy = { ...prev[i]!, key: newKey(), id: undefined };
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });
  };
  const moveRow = (key: string, delta: -1 | 1) => {
    touch();
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key);
      const j = i + delta;
      if (i === -1 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const onLanguageChange = (next: ExerciseLanguage) => {
    touch();
    // Swap untouched boilerplate for the new language's starter.
    if (!starterCode.trim() || Object.values(DEFAULT_STARTER_CODE).includes(starterCode)) setStarterCode(DEFAULT_STARTER_CODE[next]);
    setLanguage(next);
  };

  const serialized = JSON.stringify(rows.map((r) => ({ id: r.id, input: r.input, expectedOutput: r.expectedOutput, hidden: r.hidden })));

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-6" noValidate>
      {exercise && <input type="hidden" name="id" value={exercise.id} />}
      <input type="hidden" name="testCases" value={serialized} />
      <input type="hidden" name="starterCode" value={starterCode} />
      <FormError message={state && !state.ok ? state.error : null} />

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title={exercise ? t("assessAdmin.exerciseForm.editTitle") : t("assessAdmin.exerciseForm.createTitle")}
              description={t("assessAdmin.exerciseForm.description")}
              actions={dirty ? <NotSavedBadge /> : undefined}
            />
            <CardBody className="space-y-5">
              <Field label={t("assessAdmin.form.title")} htmlFor="ex-title" required error={errors?.title}>
                <Input id="ex-title" name="title" defaultValue={exercise?.title} onChange={touch} maxLength={200} placeholder={t("assessAdmin.exerciseForm.titlePlaceholder")} invalid={!!errors?.title} />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t("assessAdmin.col.language")} htmlFor="ex-language" required error={errors?.language}>
                  <Select id="ex-language" name="language" value={language} onChange={(e) => onLanguageChange(e.target.value as ExerciseLanguage)} options={LANGUAGE_OPTIONS} />
                </Field>
                <Field label={t("assessAdmin.form.course")} htmlFor="ex-course" error={errors?.courseId} hint={tc("status.optional")}>
                  <Select id="ex-course" name="courseId" defaultValue={exercise?.courseId ?? defaultCourseId ?? ""} onChange={touch}>
                    <option value="">{t("assessAdmin.noCourse")}</option>
                    {courseOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {!isRunnableLanguage(language) && (
                <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {t("assessAdmin.exerciseForm.notRunnable")}
                </p>
              )}
              {language === "typescript" && (
                <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
                  <Icon.Info className="mt-0.5 size-4 shrink-0" />
                  {t("exercise.typescriptNotice")}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={
                <span>
                  {t("assessAdmin.exerciseForm.testCases")}
                  <span className="ms-0.5 text-danger">*</span>
                </span>
              }
              description={t("assessAdmin.exerciseForm.testCasesHint")}
            />
            <CardBody className="space-y-3">
              {errors?.testCases && (
                <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {errors.testCases}
                </p>
              )}
              <ol className="space-y-3">
                {rows.map((row, i) => (
                  <li key={row.key} className={cn("rounded-xl border p-3", row.hidden ? "border-dashed border-border-strong bg-surface-2/40" : "border-border")}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink">{t("assessAdmin.exerciseForm.test", { number: i + 1 })}</p>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`tc-hidden-${row.key}`}
                          checked={row.hidden}
                          onChange={(e) => updateRow(row.key, { hidden: e.target.checked })}
                          label={<span className="text-xs font-normal text-ink-muted">{t("assessAdmin.exerciseForm.hidden")}</span>}
                        />
                        <Dropdown
                          trigger={
                            <span className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2">
                              <Icon.MoreHorizontal className="size-4" />
                              <span className="sr-only">{t("assessAdmin.exerciseForm.testActions", { number: i + 1 })}</span>
                            </span>
                          }
                          items={[
                            { label: t("assessAdmin.exerciseForm.duplicate"), icon: <Icon.Copy />, onClick: () => duplicateRow(row.key) },
                            { label: t("assessAdmin.exerciseForm.moveUp"), icon: <Icon.ChevronUp />, onClick: () => moveRow(row.key, -1), disabled: i === 0 },
                            { label: t("assessAdmin.exerciseForm.moveDown"), icon: <Icon.ChevronDown />, onClick: () => moveRow(row.key, 1), disabled: i === rows.length - 1 },
                            { label: tc("actions.delete"), icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => removeRow(row.key), disabled: rows.length === 1 },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`tc-in-${row.key}`} className="mb-1 block text-xs font-medium text-ink-muted">
                          {t("assessAdmin.exerciseForm.input")}
                        </label>
                        <textarea
                          id={`tc-in-${row.key}`}
                          value={row.input}
                          onChange={(e) => updateRow(row.key, { input: e.target.value })}
                          rows={2}
                          spellCheck={false}
                          placeholder={t("assessAdmin.exerciseForm.emptyInput")}
                          className="w-full resize-y rounded-lg border border-border-strong bg-surface-1 px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                        />
                      </div>
                      <div>
                        <label htmlFor={`tc-out-${row.key}`} className="mb-1 block text-xs font-medium text-ink-muted">
                          {t("assessAdmin.exerciseForm.expected")}
                          <span className="ms-0.5 text-danger">*</span>
                        </label>
                        <textarea
                          id={`tc-out-${row.key}`}
                          value={row.expectedOutput}
                          onChange={(e) => updateRow(row.key, { expectedOutput: e.target.value })}
                          rows={2}
                          spellCheck={false}
                          aria-invalid={!!errors?.testCases && !row.expectedOutput.trim() ? true : undefined}
                          className="w-full resize-y rounded-lg border border-border-strong bg-surface-1 px-2.5 py-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 aria-invalid:border-danger"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={rows.length >= MAX_TEST_CASES} leftIcon={<Icon.Plus className="size-4" />}>
                  {t("assessAdmin.exerciseForm.addTest")}
                </Button>
                <p className="text-xs text-ink-muted">{t("assessAdmin.exerciseForm.hiddenHint")}</p>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title={
                <span>
                  {t("assessAdmin.exerciseForm.statement")}
                  <span className="ms-0.5 text-danger">*</span>
                </span>
              }
            />
            <CardBody>
              <MarkdownEditor
                id="ex-statement"
                name="problemStatement"
                ariaLabel={t("assessAdmin.exerciseForm.statement")}
                defaultValue={exercise?.problemStatement ?? ""}
                rows={12}
                invalid={!!errors?.problemStatement}
                onChange={touch}
                placeholder={t("assessAdmin.exerciseForm.statementPlaceholder")}
              />
              {errors?.problemStatement && <p className="mt-1.5 text-xs text-danger">{errors.problemStatement}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("assessAdmin.exerciseForm.starter")} description={t("assessAdmin.exerciseForm.starterHint")} />
            <CardBody>
              <CodeEditor
                value={starterCode}
                onChange={(v) => {
                  touch();
                  setStarterCode(v);
                }}
                language={language}
                ariaLabel={t("assessAdmin.exerciseForm.starter")}
                minHeight={200}
                maxHeight={480}
              />
              {errors?.starterCode && <p className="mt-1.5 text-xs text-danger">{errors.starterCode}</p>}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {exercise && (
            <>
              <Button type="button" variant="outline" className="text-danger" onClick={() => setConfirmDelete(true)} leftIcon={<Icon.Trash className="size-4" />}>
                {t("assessAdmin.exerciseForm.delete")}
              </Button>
              <ButtonLink href={`/exercises/${exercise.id}`} variant="outline" leftIcon={<Icon.Play className="size-3.5" />}>
                {t("assessAdmin.exerciseForm.tryIt")}
              </ButtonLink>
              <ButtonLink href={`/admin/exercises/submissions?exercise=${exercise.id}`} variant="outline" leftIcon={<Icon.ClipboardList className="size-4" />}>
                {t("assessAdmin.form.checkSubmissions")}
              </ButtonLink>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Link href="/admin/exercises" className="inline-flex h-9.5 items-center rounded-lg px-4 text-sm font-medium text-ink hover:bg-surface-2">
            {tc("actions.cancel")}
          </Link>
          <Button type="submit" loading={pending} leftIcon={<Icon.Check className="size-4" />}>
            {tc("actions.save")}
          </Button>
        </div>
      </div>

      {exercise && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={t("assessAdmin.exercises.confirmTitle", { count: 1 })}
          description={t("assessAdmin.exerciseForm.deleteBody")}
          confirmLabel={tc("actions.delete")}
          destructive
          loading={deleting}
          onConfirm={() =>
            startDelete(async () => {
              const res = await deleteExercisesAction([exercise.id]);
              if (!res.ok) {
                toast({ title: res.error, tone: "error" });
                return;
              }
              toast({ title: t("assessAdmin.exerciseForm.deleted"), tone: "success" });
              setConfirmDelete(false);
              router.push("/admin/exercises");
            })
          }
        />
      )}
    </form>
  );
}

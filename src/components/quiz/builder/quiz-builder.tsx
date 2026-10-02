"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Question } from "@/lib/types";
import { deleteQuizAction, saveQuizAction } from "@/lib/actions/quiz";
import { duplicateQuestionAction, saveQuestionAction } from "@/lib/actions/questions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon, Spinner } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { cn, pluralize, stripMarkdown } from "@/lib/utils";
import { QuizIcon } from "../icons";
import { QuestionEditor, QuestionReadOnly } from "../question-editor";
import { QuizRunner } from "../quiz-runner";
import { Breadcrumbs, MarksBadge, Notice, QuestionTypeBadge } from "../shared";
import {
  computeTotalMarks,
  emptyQuestionInput,
  MAX_MARKS,
  questionToInput,
  toUiType,
  validateQuestionInput,
  type QuestionBankItem,
  type QuestionInput,
  type QuizEditorData,
  type QuizQuestionRow,
  type QuizSettingsInput,
  type RunnerPayload,
  type UiQuestionType,
} from "../types";
import { BankPanel, type BankScope } from "./bank-panel";
import { useLeaveGuard, useSessionFlag } from "./hooks";
import { SettingsPanel } from "./settings-panel";

/* ------------------------------------------------------------------ */
/* Validation helpers                                                   */
/* ------------------------------------------------------------------ */

/** Mirrors saveQuizAction: a quiz is either entirely open ended or has no open-ended questions. */
const OPEN_ENDED_MIX_ERROR = "If you want open ended questions then make sure each question in the quiz is of open ended type.";
const OPEN_ONLY: UiQuestionType[] = ["open_ended"];
const CLOSED_ONLY: UiQuestionType[] = ["single", "multiple", "user_input"];

function settingsErrors(s: QuizSettingsInput, rows: QuizQuestionRow[], mixedTypes = false): Record<string, string> {
  const e: Record<string, string> = {};
  if (mixedTypes) e.questions = OPEN_ENDED_MIX_ERROR;
  if (!s.title.trim()) e.title = "Title is required.";
  if (!Number.isFinite(s.passingPercentage) || s.passingPercentage < 0 || s.passingPercentage > 100) e.passingPercentage = "Passing percentage must be between 0 and 100.";
  if (!Number.isInteger(s.maxAttempts) || s.maxAttempts < 0 || s.maxAttempts > 1000) e.maxAttempts = "Enter 0 (unlimited) or a whole number.";
  if (!Number.isFinite(s.durationMinutes) || s.durationMinutes < 0 || s.durationMinutes > 1440) e.durationMinutes = "Enter 0 (no limit) or up to 1,440 minutes.";
  if (s.shuffleQuestions) {
    if (!Number.isInteger(s.limitQuestionsTo) || s.limitQuestionsTo < 0) e.limitQuestionsTo = "Enter 0 (use all questions) or a whole number.";
    else if (s.limitQuestionsTo > 0 && s.limitQuestionsTo >= rows.length) e.limitQuestionsTo = "Limit cannot be greater than or equal to the number of questions in the quiz.";
    else if (s.limitQuestionsTo > 0 && new Set(rows.map((r) => r.marks)).size > 1) e.limitQuestionsTo = "All questions should have the same marks if the limit is set.";
  }
  if (s.enableNegativeMarking && (!Number.isFinite(s.marksToCut) || s.marksToCut <= 0)) e.marksToCut = "Marks to deduct must be greater than 0.";
  if (s.enableProctoring && (!Number.isInteger(s.maxViolations) || s.maxViolations < 1 || s.maxViolations > 50)) e.maxViolations = "Max violations must be a whole number between 1 and 50.";
  if (s.enableScheduling) {
    if (!s.scheduleStart) e.scheduleStart = "Set a start time, or turn scheduling off.";
    else if (s.scheduleEnd && Date.parse(s.scheduleEnd) <= Date.parse(s.scheduleStart)) e.scheduleEnd = "The end time has to come after the start time.";
  }
  return e;
}

/** Replace values of switched-off settings with safe defaults before sending. */
function sanitizeSettings(s: QuizSettingsInput): QuizSettingsInput {
  return {
    ...s,
    limitQuestionsTo: s.shuffleQuestions && Number.isFinite(s.limitQuestionsTo) ? s.limitQuestionsTo : 0,
    marksToCut: Number.isFinite(s.marksToCut) && s.marksToCut > 0 ? s.marksToCut : 1,
    maxViolations: Number.isInteger(s.maxViolations) && s.maxViolations > 0 ? s.maxViolations : 3,
    scheduleStart: s.enableScheduling ? s.scheduleStart : "",
    scheduleEnd: s.enableScheduling ? s.scheduleEnd : "",
  };
}

/** Wall-clock time for event handlers (kept out of render). */
function currentTime(): number {
  return Date.now();
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

/* ------------------------------------------------------------------ */
/* Builder                                                              */
/* ------------------------------------------------------------------ */

export function QuizBuilder({ data, viewerName }: { data: QuizEditorData; viewerName: string }) {
  const { toast } = useToast();

  // Quiz document.
  const [settings, setSettings] = useState<QuizSettingsInput>(data.settings);
  const [rows, setRows] = useState<QuizQuestionRow[]>(data.rows);
  const [questions, setQuestions] = useState<Record<string, Question>>(data.questions);
  const [usage, setUsage] = useState<Record<string, number>>(data.usage);
  const [editable, setEditable] = useState<string[]>(data.editable);
  const [authors, setAuthors] = useState<Record<string, string>>(data.authorNames);

  // Save state.
  const [version, setVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [failedVersion, setFailedVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  // Question editing.
  const [openId, setOpenId] = useState<string | null>(null);
  const [openValue, setOpenValue] = useState<QuestionInput | null>(null);
  const [openOriginal, setOpenOriginal] = useState("");
  const [draft, setDraft] = useState<QuestionInput | null>(null);
  const [editorAttempted, setEditorAttempted] = useState(false);
  const [editorServerErrors, setEditorServerErrors] = useState<Record<string, string>>({});
  const [persisting, setPersisting] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Layout.
  const [bankOpen, setBankOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<RunnerPayload | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [openingPreview, setOpeningPreview] = useState(false);
  const [mobileTab, setMobileTab] = useState<"questions" | "settings">(data.rows.length ? "questions" : "settings");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = version !== savedVersion;
  const openDirty = openValue !== null && JSON.stringify(openValue) !== openOriginal;
  /** The open question's own content changed (not just its marks in this quiz). */
  const openContentDirty = (() => {
    if (!openValue || !openOriginal) return false;
    const original = JSON.parse(openOriginal) as QuestionInput;
    return JSON.stringify({ ...openValue, marks: 0 }) !== JSON.stringify({ ...original, marks: 0 });
  })();
  const unsaved = dirty || !!draft || openDirty;
  const guard = useLeaveGuard(unsaved);
  const [noticeDismissed, setNoticeDismissed] = useSessionFlag(`lms:quiz:${data.quizId}:open-ended-notice-dismissed`);

  const typeOfRow = (id: string): UiQuestionType => {
    const q = questions[id];
    return q ? toUiType(q.type, q.multiple) : "single";
  };
  const rowsHaveOpen = rows.some((r) => questions[r.questionId]?.type === "open_ended");
  const rowsHaveClosed = rows.some((r) => questions[r.questionId] && questions[r.questionId]!.type !== "open_ended");
  const hasOpenEnded = rowsHaveOpen || draft?.uiType === "open_ended" || openValue?.uiType === "open_ended";
  const limit = settings.shuffleQuestions && Number.isInteger(settings.limitQuestionsTo) ? settings.limitQuestionsTo : 0;
  const totalMarks = computeTotalMarks(rows, settings.shuffleQuestions, limit);
  // Quizzes that mixed both kinds before the rule existed stay saveable until a question is added (see saveQuizAction).
  const legacyMixed = (() => {
    const initial = data.rows.map((r) => data.questions[r.questionId]).filter((q): q is Question => !!q);
    const mixed = initial.some((q) => q.type === "open_ended") && initial.some((q) => q.type !== "open_ended");
    return mixed && rows.every((r) => data.rows.some((i) => i.questionId === r.questionId));
  })();
  const mixedTypes = rowsHaveOpen && rowsHaveClosed && !legacyMixed;
  // Open-ended questions can't be mixed with auto-graded ones: restrict the bank and the type picker accordingly.
  const bankScope: BankScope = mixedTypes ? "any" : rowsHaveOpen ? "open_ended" : rowsHaveClosed ? "closed" : "any";
  const allowedTypesFor = (excludeId: string | null): UiQuestionType[] | undefined => {
    const others = rows.filter((r) => r.questionId !== excludeId).map((r) => questions[r.questionId]).filter((q): q is Question => !!q);
    const open = others.some((q) => q.type === "open_ended");
    const closed = others.some((q) => q.type !== "open_ended");
    if (open === closed) return undefined;
    return open ? OPEN_ONLY : CLOSED_ONLY;
  };
  const clientErrors = settingsErrors(settings, rows, mixedTypes);
  const settingsNeedAttention = Object.keys(clientErrors).some((k) => k !== "questions");
  const errors = { ...serverErrors, ...clientErrors };
  const canReorder = !openId && !draft && !search.trim() && rows.length > 1;

  /* ---------------------------- Editing the quiz ---------------------------- */

  const bump = () => setVersion((v) => v + 1);

  const changeSettings = (patch: Partial<QuizSettingsInput>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setServerErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
    bump();
  };

  const changeRows = (updater: (prev: QuizQuestionRow[]) => QuizQuestionRow[]) => {
    setRows(updater);
    setServerErrors((prev) => {
      if (!prev.questions && !prev.limitQuestionsTo) return prev;
      const next = { ...prev };
      delete next.questions;
      delete next.limitQuestionsTo;
      return next;
    });
    bump();
  };

  const saveQuiz = async (explicit: boolean): Promise<boolean> => {
    if (saving) return false;
    const v = version;
    const local = settingsErrors(settings, rows, mixedTypes);
    if (Object.keys(local).length) {
      setFailedVersion(v);
      if (explicit) toast({ title: Object.values(local)[0] ?? "Please fix the highlighted fields.", tone: "error" });
      return false;
    }
    setSaving(true);
    try {
      const res = await saveQuizAction({ quizId: data.quizId, settings: sanitizeSettings(settings), questions: rows });
      if (res.ok) {
        setSavedVersion(v);
        setFailedVersion(null);
        setSaveError(null);
        setServerErrors({});
        if (res.data.showAnswers !== settings.showAnswers) setSettings((prev) => ({ ...prev, showAnswers: res.data.showAnswers }));
        if (explicit) toast({ title: "Quiz updated successfully", tone: "success" });
        return true;
      }
      setFailedVersion(v);
      setServerErrors(res.fieldErrors ?? {});
      setSaveError(res.error);
      toast({ title: `${res.error} Your changes are not saved.`, tone: "error" });
      return false;
    } catch {
      setFailedVersion(v);
      setSaveError("We couldn't reach the server.");
      toast({ title: "We couldn't reach the server. Your changes are not saved.", tone: "error" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Autosave 1.2s after the last change, unless a question card is open, a draft exists or the last attempt failed.
  const saveRef = useRef(saveQuiz);
  useEffect(() => {
    saveRef.current = saveQuiz;
  });
  useEffect(() => {
    if (!dirty || draft || openId || saving || preview || failedVersion === version) return;
    const t = window.setTimeout(() => void saveRef.current(false), 1200);
    return () => window.clearTimeout(t);
  }, [dirty, draft, openId, saving, preview, failedVersion, version]);

  // Show the manual-grading notice again if open-ended questions come back later.
  useEffect(() => {
    if (!hasOpenEnded && noticeDismissed) setNoticeDismissed(false);
  }, [hasOpenEnded, noticeDismissed, setNoticeDismissed]);

  /* ---------------------------- Question cards ---------------------------- */

  const closeCard = () => {
    setOpenId(null);
    setOpenValue(null);
    setOpenOriginal("");
    setEditorServerErrors({});
  };

  const openCard = (id: string) => {
    if (openId === id) return;
    if (draft || openDirty) {
      toast({ title: "Save or close the open question first.", tone: "warning" });
      return;
    }
    const q = questions[id];
    if (!q) return;
    const row = rows.find((r) => r.questionId === id);
    const input = { ...questionToInput(q), marks: row?.marks ?? q.marks };
    setOpenId(id);
    setOpenValue(input);
    setOpenOriginal(JSON.stringify(input));
    setEditorAttempted(true);
    setEditorServerErrors({});
    setMobileTab("questions");
  };

  const saveOpen = async () => {
    if (!openId || !openValue || persisting) return;
    setEditorAttempted(true);
    const canEdit = editable.includes(openId);
    if (canEdit && Object.keys(validateQuestionInput(openValue)).length) return;
    if (!canEdit && (!Number.isInteger(openValue.marks) || openValue.marks < 1 || openValue.marks > MAX_MARKS)) return;
    const id = openId;
    const marks = openValue.marks;
    if (canEdit && openContentDirty) {
      setPersisting(true);
      try {
        // The marks field is "Marks in this quiz": it only changes the quiz row, never the bank question's default marks.
        const res = await saveQuestionAction({ ...openValue, marks: questions[id]?.marks ?? openValue.marks, id });
        if (!res.ok) {
          setEditorServerErrors(res.fieldErrors ?? {});
          toast({ title: res.error, tone: "error" });
          return;
        }
        setQuestions((prev) => ({ ...prev, [id]: res.data.question }));
        setUsage((prev) => ({ ...prev, [id]: res.data.usedIn }));
      } catch {
        toast({ title: "Could not save the question. Please try again.", tone: "error" });
        return;
      } finally {
        setPersisting(false);
      }
    }
    if (rows.find((r) => r.questionId === id)?.marks !== marks) {
      changeRows((prev) => prev.map((r) => (r.questionId === id ? { ...r, marks } : r)));
    }
    closeCard();
  };

  const newQuestion = () => {
    if (draft) return;
    if (openDirty) {
      toast({ title: "Save or close the open question first.", tone: "warning" });
      return;
    }
    closeCard();
    setBankOpen(false);
    setMobileTab("questions");
    // All-written quizzes default to another open-ended question.
    setDraft(emptyQuestionInput(rowsHaveOpen && !rowsHaveClosed ? "open_ended" : "single"));
    setEditorAttempted(false);
    setEditorServerErrors({});
  };

  const saveDraft = async () => {
    if (!draft || persisting) return;
    setEditorAttempted(true);
    if (Object.keys(validateQuestionInput(draft)).length) return;
    setPersisting(true);
    try {
      const res = await saveQuestionAction({ ...draft, id: undefined });
      if (!res.ok) {
        setEditorServerErrors(res.fieldErrors ?? {});
        toast({ title: res.error, tone: "error" });
        return;
      }
      const q = res.data.question;
      setQuestions((prev) => ({ ...prev, [q.id]: q }));
      setUsage((prev) => ({ ...prev, [q.id]: 0 }));
      setEditable((prev) => [...prev, q.id]);
      setAuthors((prev) => ({ ...prev, [q.id]: viewerName }));
      changeRows((prev) => [...prev, { questionId: q.id, marks: draft.marks }]);
      setDraft(null);
      toast({ title: "Question added", tone: "success" });
    } catch {
      toast({ title: "Could not save the question. Please try again.", tone: "error" });
    } finally {
      setPersisting(false);
    }
  };

  const duplicateRow = async (id: string, fromEditor?: QuestionInput) => {
    if (busyRow) return;
    setBusyRow(id);
    try {
      const res = fromEditor ? await saveQuestionAction({ ...fromEditor, id: undefined }) : await duplicateQuestionAction(id);
      if (!res.ok) {
        toast({ title: res.error, tone: "error" });
        return;
      }
      const q = res.data.question;
      setQuestions((prev) => ({ ...prev, [q.id]: q }));
      setUsage((prev) => ({ ...prev, [q.id]: 0 }));
      setEditable((prev) => [...prev, q.id]);
      setAuthors((prev) => ({ ...prev, [q.id]: viewerName }));
      changeRows((prev) => {
        const idx = prev.findIndex((r) => r.questionId === id);
        const marks = fromEditor?.marks ?? prev[idx]?.marks ?? q.marks;
        const next = [...prev];
        next.splice(idx + 1, 0, { questionId: q.id, marks });
        return next;
      });
      toast({ title: "Question duplicated", tone: "success" });
    } catch {
      toast({ title: "Could not duplicate the question.", tone: "error" });
    } finally {
      setBusyRow(null);
    }
  };

  const removeRow = (id: string) => {
    if (openId === id) closeCard();
    changeRows((prev) => prev.filter((r) => r.questionId !== id));
    setRemoveTarget(null);
  };

  const moveRow = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    changeRows((prev) => move(prev, from, to));
  };

  const addFromBank = (items: QuestionBankItem[]) => {
    const fresh = items.filter((i) => !rows.some((r) => r.questionId === i.question.id));
    if (!fresh.length) return;
    setQuestions((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((i) => [i.question.id, i.question])) }));
    setUsage((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((i) => [i.question.id, i.usedIn])) }));
    setEditable((prev) => [...prev, ...fresh.filter((i) => i.canEdit).map((i) => i.question.id)]);
    setAuthors((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((i) => [i.question.id, i.authorName])) }));
    changeRows((prev) => [...prev, ...fresh.map((i) => ({ questionId: i.question.id, marks: i.question.marks > 0 ? i.question.marks : 1 }))]);
    setBankOpen(false);
    setMobileTab("questions");
    toast({ title: `${pluralize(fresh.length, "question")} added`, tone: "success" });
  };

  /* ---------------------------- Keyboard shortcut ---------------------------- */

  const shortcutRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    shortcutRef.current = () => {
      if (preview) return;
      if (draft) void saveDraft();
      else if (openId) void saveOpen();
      else void saveQuiz(true);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        shortcutRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------------------- Preview & delete ---------------------------- */

  const buildPreview = (now: number): RunnerPayload => {
    const entries = rows.map((r) => ({ q: questions[r.questionId], marks: r.marks })).filter((e): e is { q: Question; marks: number } => !!e.q);
    const count = limit > 0 && limit < entries.length ? limit : entries.length;
    const open = entries.some((e) => e.q.type === "open_ended");
    const course = data.courses.find((c) => c.id === settings.courseId);
    return {
      quiz: {
        id: data.quizId,
        title: settings.title.trim() || "Untitled quiz",
        description: settings.description.trim() || undefined,
        courseId: settings.courseId || undefined,
        courseTitle: course?.title,
        questionCount: count,
        totalMarks,
        passingPercentage: settings.passingPercentage,
        maxAttempts: settings.maxAttempts,
        showAnswers: settings.showAnswers && !open,
        showSubmissionHistory: settings.showSubmissionHistory,
        shuffleQuestions: settings.shuffleQuestions,
        limitQuestionsTo: limit,
        durationSeconds: Math.round(settings.durationMinutes * 60),
        enableNegativeMarking: settings.enableNegativeMarking,
        marksToCut: settings.marksToCut,
        enableScheduling: settings.enableScheduling,
        scheduleStart: settings.enableScheduling ? settings.scheduleStart || undefined : undefined,
        scheduleEnd: settings.enableScheduling ? settings.scheduleEnd || undefined : undefined,
        enableProctoring: settings.enableProctoring,
        maxViolations: settings.maxViolations,
        questions: entries.map((e) => ({
          id: e.q.id,
          text: e.q.text,
          type: e.q.type,
          multiple: e.q.type === "choices" && e.q.multiple,
          marks: e.marks,
          options: e.q.type === "choices" ? e.q.options.map((o) => ({ id: o.id, text: o.text })) : [],
        })),
        questionsWithheld: false,
        poolSize: entries.length,
        hasOpenEnded: open,
      },
      attempts: [],
      canManage: true,
      serverTime: now,
    };
  };

  const togglePreview = async () => {
    if (preview) {
      setPreview(null);
      return;
    }
    if (draft || openId) {
      toast({ title: "Save or close the open question first.", tone: "warning" });
      return;
    }
    if (!rows.length) {
      toast({ title: "Add a question before previewing.", tone: "warning" });
      return;
    }
    setOpeningPreview(true);
    const ok = dirty ? await saveQuiz(true) : true;
    setOpeningPreview(false);
    if (!ok) {
      // The field errors live in the "Details & settings" tab, which is hidden on small screens.
      if (settingsNeedAttention) setMobileTab("settings");
      return;
    }
    setBankOpen(false);
    setMobileTab("questions");
    setPreview(buildPreview(currentTime()));
    setPreviewKey((k) => k + 1);
  };

  const deleteQuiz = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await deleteQuizAction(data.quizId);
      if (res.ok) {
        toast({ title: "Quiz deleted successfully", tone: "success" });
        guard.bypass("/admin/quizzes");
        return;
      }
      toast({ title: res.error || "Could not delete the quiz", tone: "error" });
    } catch {
      toast({ title: "Could not delete the quiz", tone: "error" });
    }
    setDeleting(false);
    setConfirmDelete(false);
  };

  /* ---------------------------- Render ---------------------------- */

  const term = search.trim().toLowerCase();
  const visibleRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !term || stripMarkdown(questions[row.questionId]?.text ?? "").toLowerCase().includes(term));

  const statusBadge = saving ? (
    <Badge tone="neutral">
      <Spinner className="size-3" />
      Saving…
    </Badge>
  ) : unsaved ? (
    <Badge tone="warning" dot>
      Not saved
    </Badge>
  ) : (
    <Badge tone="success" dot>
      Saved
    </Badge>
  );

  const editorBlock = (value: QuestionInput, onChange: (v: QuestionInput) => void, excludeId: string | null, isDraft: boolean) => (
    <QuestionEditor
      value={value}
      onChange={(v) => {
        onChange(v);
        if (Object.keys(editorServerErrors).length) setEditorServerErrors({});
      }}
      errors={{ ...validateQuestionInput(value), ...editorServerErrors }}
      showErrors={editorAttempted}
      usedIn={excludeId ? usage[excludeId] : undefined}
      disabled={persisting}
      autoFocus={isDraft}
      marksLabel={isDraft ? "Marks" : "Marks in this quiz"}
      allowedTypes={allowedTypesFor(excludeId)}
    />
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Quizzes", href: "/admin/quizzes" }, { label: settings.title.trim() || "Untitled quiz" }]} />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate">{settings.title.trim() || "Untitled quiz"}</span>
            {statusBadge}
          </span>
        }
        description={`${pluralize(rows.length, "question")} · ${pluralize(totalMarks, "mark")} · pass at ${Number.isFinite(settings.passingPercentage) ? settings.passingPercentage : 0}%`}
        actions={
          <>
            <Button
              variant="subtle"
              onClick={() => void togglePreview()}
              aria-pressed={!!preview}
              loading={openingPreview}
              disabled={!preview && (!!draft || !!openId)}
              title={!preview && (draft || openId) ? "Save or close the open question first" : undefined}
              leftIcon={preview ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}
            >
              {preview ? "Close preview" : "Preview"}
            </Button>
            <ButtonLink href={`/admin/quizzes/submissions?quiz=${data.quizId}`} variant="subtle" leftIcon={<Icon.ClipboardList className="size-4" />}>
              Submissions
              {data.submissionCount > 0 && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] tabular-nums">{data.submissionCount}</span>}
            </ButtonLink>
            <Button onClick={() => void saveQuiz(true)} loading={saving} disabled={!dirty || !!preview} leftIcon={<Icon.Check className="size-4" />} title="Save (Ctrl+S / ⌘S)">
              Save
            </Button>
            <IconButton
              label={data.canDelete ? "Delete quiz" : "Only moderators can delete a quiz that learners have taken"}
              variant="ghost"
              className="text-danger hover:bg-danger/10"
              onClick={() => setConfirmDelete(true)}
              disabled={!data.canDelete}
            >
              <Icon.Trash className="size-4" />
            </IconButton>
          </>
        }
      />

      {saveError && (
        <Notice tone="danger" role="alert" title="Your changes are not saved" className="mb-4" action={<Button size="sm" variant="outline" onClick={() => void saveQuiz(true)}>Retry</Button>}>
          {saveError} Do not close this tab until they are.
        </Notice>
      )}

      {settingsNeedAttention && mobileTab === "questions" && (
        <Notice
          tone="warning"
          role="status"
          className="mb-4 lg:hidden"
          action={
            <Button size="sm" variant="outline" onClick={() => setMobileTab("settings")}>
              Review settings
            </Button>
          }
        >
          Some settings need attention before your changes can be saved.
        </Notice>
      )}

      <SegmentedControl
        className="mb-4 lg:hidden"
        size="md"
        value={mobileTab}
        onChange={setMobileTab}
        options={[
          { value: "questions", label: `Questions (${rows.length})` },
          { value: "settings", label: bankOpen ? "Question bank" : "Details & settings" },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className={cn("min-w-0", mobileTab !== "questions" && "hidden lg:block")}>
          {preview ? (
            <div className="mx-auto max-w-2xl">
              <QuizRunner key={previewKey} payload={preview} mode="preview" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <Input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search questions"
                    aria-label="Search questions in this quiz"
                    leftAddon={<Icon.Search className="size-4" />}
                    disabled={!rows.length}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="subtle" onClick={newQuestion} disabled={!!draft} leftIcon={<Icon.Plus className="size-4" />}>
                    New question
                  </Button>
                  <Button
                    variant="subtle"
                    onClick={() => {
                      setBankOpen((v) => !v);
                      setMobileTab("settings");
                    }}
                    aria-pressed={bankOpen}
                    leftIcon={<QuizIcon.Library className="size-4" />}
                  >
                    {bankOpen ? "Close bank" : "Question bank"}
                  </Button>
                </div>
              </div>

              {hasOpenEnded && !noticeDismissed && (
                <Notice
                  tone="warning"
                  title="Manual grading"
                  action={
                    <IconButton label="Dismiss" size="icon-sm" onClick={() => setNoticeDismissed(true)}>
                      <Icon.X className="size-4" />
                    </IconButton>
                  }
                >
                  Learners write free-form answers to open-ended questions. Those answers score 0 and the attempt stays pending until you grade it; the other questions are marked automatically.{" "}
                  <Link href={`/admin/quizzes/submissions?quiz=${data.quizId}`} className="font-medium text-ink underline underline-offset-2">
                    Grade submissions
                  </Link>
                  {data.pendingGradingCount > 0 && ` (${data.pendingGradingCount} waiting)`}
                </Notice>
              )}

              {errors.questions && (
                <Notice tone="danger" role="alert">
                  {errors.questions}
                </Notice>
              )}

              {rows.length === 0 && !draft ? (
                <EmptyState
                  icon={<Icon.CircleDot />}
                  title="No questions yet"
                  description="Create the first question and edit it in place: options, the right answers and explanations live together in a single card."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button variant="subtle" onClick={newQuestion} leftIcon={<Icon.Plus className="size-4" />}>
                        New question
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setBankOpen(true);
                          setMobileTab("settings");
                        }}
                        leftIcon={<QuizIcon.Library className="size-4" />}
                      >
                        Add from question bank
                      </Button>
                    </div>
                  }
                />
              ) : (
                <>
                  {term && visibleRows.length === 0 && <p className="py-6 text-center text-sm text-ink-muted">No questions in this quiz match “{search.trim()}”.</p>}
                  <ol className="space-y-3">
                    {visibleRows.map(({ row, index }) => {
                      const q = questions[row.questionId];
                      if (!q) return null;
                      const isOpen = openId === row.questionId;
                      const uiType = typeOfRow(row.questionId);
                      const plain = stripMarkdown(q.text);
                      const canEdit = editable.includes(row.questionId);
                      return (
                        <li
                          key={row.questionId}
                          draggable={canReorder && !isOpen}
                          onDragStart={(e) => {
                            if (!canReorder) {
                              e.preventDefault();
                              return;
                            }
                            setDragIndex(index);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", row.questionId);
                          }}
                          onDragOver={(e) => {
                            if (dragIndex === null) return;
                            e.preventDefault();
                            if (overIndex !== index) setOverIndex(index);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragIndex !== null && dragIndex !== index) moveRow(dragIndex, index);
                            setDragIndex(null);
                            setOverIndex(null);
                          }}
                          onDragEnd={() => {
                            setDragIndex(null);
                            setOverIndex(null);
                          }}
                          className={cn(
                            "rounded-xl border bg-surface-1 transition-shadow",
                            isOpen ? "border-accent/50 shadow-card" : "border-border",
                            dragIndex === index && "opacity-50",
                            overIndex === index && dragIndex !== null && dragIndex !== index && "ring-2 ring-accent/50",
                          )}
                        >
                          {isOpen && openValue ? (
                            <div className="p-4 sm:p-5">
                              <div className="mb-4 flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-ink">
                                  Question {index + 1}
                                  {!canEdit && <span className="ml-2 font-normal text-ink-muted">by {authors[row.questionId] ?? "another author"}</span>}
                                </p>
                                <IconButton label="Close" size="icon-sm" onClick={closeCard} disabled={persisting}>
                                  <Icon.X className="size-4" />
                                </IconButton>
                              </div>
                              {canEdit ? (
                                editorBlock(openValue, setOpenValue, row.questionId, false)
                              ) : (
                                <div className="space-y-4">
                                  <Notice tone="info">
                                    Only {authors[row.questionId] ?? "the author"} or a moderator can edit this question. Duplicate it to make your own copy — you can still set
                                    its marks for this quiz.
                                  </Notice>
                                  <QuestionReadOnly value={openValue} />
                                  <div className="w-40">
                                    <label htmlFor={`marks-${row.questionId}`} className="mb-1.5 block text-xs font-medium text-ink-muted">
                                      Marks in this quiz
                                    </label>
                                    <Input
                                      id={`marks-${row.questionId}`}
                                      type="number"
                                      min={1}
                                      max={MAX_MARKS}
                                      step={1}
                                      value={Number.isFinite(openValue.marks) ? String(openValue.marks) : ""}
                                      onChange={(e) => setOpenValue({ ...openValue, marks: e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)) })}
                                    />
                                  </div>
                                </div>
                              )}
                              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void duplicateRow(row.questionId, canEdit ? openValue : undefined)}
                                    loading={busyRow === row.questionId}
                                    disabled={canEdit && Object.keys(validateQuestionInput(openValue)).length > 0}
                                    leftIcon={<Icon.Copy className="size-4" />}
                                  >
                                    Duplicate
                                  </Button>
                                  <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setRemoveTarget(row.questionId)} leftIcon={<Icon.Trash className="size-4" />}>
                                    Remove
                                  </Button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button variant="outline" size="sm" onClick={closeCard} disabled={persisting}>
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => void saveOpen()}
                                    loading={persisting}
                                    disabled={canEdit ? editorAttempted && Object.keys(validateQuestionInput(openValue)).length > 0 : !Number.isInteger(openValue.marks) || openValue.marks < 1}
                                    leftIcon={<Icon.Check className="size-4" />}
                                  >
                                    Save question
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 px-2 py-2 sm:gap-3 sm:px-3">
                              <span
                                className={cn("shrink-0 text-ink-faint", canReorder ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed opacity-40")}
                                title={canReorder ? "Drag to reorder" : "Close open questions (and clear the search) to reorder"}
                                aria-hidden="true"
                              >
                                <Icon.Grip className="size-4" />
                              </span>
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-xs font-semibold tabular-nums text-ink-muted">{index + 1}</span>
                              <button type="button" onClick={() => openCard(row.questionId)} className="min-w-0 flex-1 py-1 text-left" aria-label={`Edit question ${index + 1}`}>
                                <span className={cn("block truncate text-sm font-medium", plain ? "text-ink" : "italic text-ink-faint")}>{plain || "Untitled question"}</span>
                                <span className="mt-1 flex flex-wrap gap-1.5 md:hidden">
                                  <QuestionTypeBadge type={uiType} />
                                  <MarksBadge marks={row.marks} />
                                </span>
                              </button>
                              <span className="hidden shrink-0 items-center gap-1.5 md:flex">
                                <QuestionTypeBadge type={uiType} />
                                <MarksBadge marks={row.marks} />
                              </span>
                              <span className="hidden shrink-0 sm:flex">
                                <IconButton label={`Move question ${index + 1} up`} size="icon-sm" disabled={!canReorder || index === 0} onClick={() => moveRow(index, index - 1)}>
                                  <QuizIcon.ArrowUp className="size-4" />
                                </IconButton>
                                <IconButton label={`Move question ${index + 1} down`} size="icon-sm" disabled={!canReorder || index === rows.length - 1} onClick={() => moveRow(index, index + 1)}>
                                  <QuizIcon.ArrowDown className="size-4" />
                                </IconButton>
                              </span>
                              {busyRow === row.questionId ? (
                                <Spinner className="mx-2 size-4" />
                              ) : (
                                <Dropdown
                                  trigger={
                                    <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={`Actions for question ${index + 1}`}>
                                      <Icon.MoreHorizontal className="size-4" />
                                    </span>
                                  }
                                  items={[
                                    { label: canEdit ? "Edit" : "View", icon: <Icon.Edit />, onClick: () => openCard(row.questionId) },
                                    { label: "Duplicate", icon: <Icon.Copy />, onClick: () => void duplicateRow(row.questionId) },
                                    { label: "Move up", icon: <QuizIcon.ArrowUp />, onClick: () => moveRow(index, index - 1), disabled: !canReorder || index === 0 },
                                    { label: "Move down", icon: <QuizIcon.ArrowDown />, onClick: () => moveRow(index, index + 1), disabled: !canReorder || index === rows.length - 1 },
                                    { label: "Open in question bank", icon: <QuizIcon.Library />, href: `/admin/questions/${row.questionId}` },
                                    { label: "Remove from quiz", icon: <Icon.Trash />, onClick: () => setRemoveTarget(row.questionId), destructive: true, separator: true },
                                  ]}
                                />
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>

                  {draft && (
                    <div className="rounded-xl border border-dashed border-accent/60 bg-surface-1 p-4 shadow-card sm:p-5">
                      <div className="mb-4 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">New question</p>
                        <IconButton label="Discard new question" size="icon-sm" onClick={() => setDraft(null)} disabled={persisting}>
                          <Icon.X className="size-4" />
                        </IconButton>
                      </div>
                      {editorBlock(draft, setDraft, null, true)}
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setDraft(null)} disabled={persisting} leftIcon={<Icon.Trash className="size-4" />}>
                          Discard
                        </Button>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-ink-muted">Not saved yet</span>
                          <Button
                            size="sm"
                            onClick={() => void saveDraft()}
                            loading={persisting}
                            disabled={editorAttempted && Object.keys(validateQuestionInput(draft)).length > 0}
                            leftIcon={<Icon.Check className="size-4" />}
                          >
                            Save question
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {rows.length > 0 && !draft && (
                    <button
                      type="button"
                      onClick={newQuestion}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent"
                    >
                      <Icon.Plus className="size-4" />
                      Add another question
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <aside className={cn("min-w-0", mobileTab !== "settings" && "hidden lg:block")}>
          <div className="rounded-card border border-border bg-surface-1 p-5 shadow-card lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto scrollbar-thin">
            {bankOpen ? (
              <div className="flex h-full min-h-96 flex-col">
                <BankPanel exclude={rows.map((r) => r.questionId)} scope={bankScope} onAdd={addFromBank} onClose={() => setBankOpen(false)} />
              </div>
            ) : (
              <SettingsPanel
                settings={settings}
                onChange={changeSettings}
                errors={errors}
                questionCount={rows.length}
                totalMarks={totalMarks}
                courses={data.courses}
                hasOpenEnded={hasOpenEnded}
                placements={data.placements}
              />
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) removeRow(removeTarget);
        }}
        destructive
        confirmLabel="Remove"
        title="Remove this question from the quiz?"
        description="The question stays in the question bank and in any other quiz that uses it."
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (deleting ? undefined : setConfirmDelete(false))}
        onConfirm={deleteQuiz}
        loading={deleting}
        destructive
        confirmLabel="Delete"
        title="Delete this quiz?"
        description={`Deleting this quiz permanently removes it${data.submissionCount ? ` and its ${pluralize(data.submissionCount, "submission")}` : " and its submissions"}, and takes it out of every lesson that embeds it. This action cannot be undone. Are you sure you want to continue?`}
      />
      <ConfirmDialog
        open={guard.pendingHref !== null}
        onClose={guard.cancel}
        onConfirm={guard.confirm}
        destructive
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        title="Leave without saving?"
        description="The questions you have added, removed or reordered and any open edits are not saved yet. Leaving this page discards them."
      />
    </div>
  );
}

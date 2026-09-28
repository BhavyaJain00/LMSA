"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { submitExerciseAction } from "@/lib/actions/exercises";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { CodeEditor } from "./code-editor";
import { runTestsInBrowser } from "./js-runner";
import { TestResultsList } from "./test-results";
import { ExerciseStatusBadge } from "./status-badges";
import { LocalDateTime } from "./client-time";
import {
  LANGUAGE_LABELS,
  NOT_RUNNABLE_NOTICE,
  TYPESCRIPT_NOTICE,
  isRunnableLanguage,
  lessonQuery,
  type ExerciseSubmissionView,
  type RunnerExercise,
  type TestResultView,
} from "./shared";

export interface ExerciseRunnerProps {
  exercise: RunnerExercise;
  initialCode: string;
  submission: ExerciseSubmissionView | null;
  lessonId?: string;
  courseId?: string;
  variant?: "page" | "inline";
  /** Logged-in viewer working on their own attempt. */
  canSubmit: boolean;
  /** Where guests log in (keeps them on this page afterwards). */
  loginHref?: string;
  /** Staff see hidden test details. */
  revealHidden?: boolean;
}

function mergeLogs(serverResults: TestResultView[], local: TestResultView[] | null): TestResultView[] {
  if (!local) return serverResults;
  const byId = new Map(local.map((r) => [r.testCaseId, r]));
  return serverResults.map((r) => {
    const mine = byId.get(r.testCaseId);
    return mine ? { ...r, logs: mine.logs, durationMs: mine.durationMs } : r;
  });
}

export function ExerciseRunner({
  exercise,
  initialCode,
  submission: initialSubmission,
  lessonId,
  courseId,
  variant = "page",
  canSubmit,
  loginHref = "/login",
  revealHidden = false,
}: ExerciseRunnerProps) {
  const { toast } = useToast();
  const runnable = isRunnableLanguage(exercise.language);
  const [code, setCode] = useState(initialCode);
  const [results, setResults] = useState<TestResultView[] | null>(initialSubmission && runnable ? initialSubmission.results : null);
  const [running, setRunning] = useState(false);
  const [lastRunCode, setLastRunCode] = useState<string | null>(initialSubmission ? initialSubmission.code : null);
  const [submission, setSubmission] = useState<ExerciseSubmissionView | null>(initialSubmission);
  const [notice, setNotice] = useState<{ tone: "warning" | "success" | "info"; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, startTransition] = useTransition();
  const resultsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const dirty = submission ? code !== submission.code : code !== initialCode;

  const run = async (): Promise<TestResultView[] | null> => {
    if (!runnable || running) return null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setNotice(null);
    setResults([]);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      const out = await runTestsInBrowser(code, exercise.tests, {
        signal: controller.signal,
        onResult: (r) => setResults((prev) => [...(prev ?? []), r]),
      });
      setResults(out);
      setLastRunCode(code);
      return out;
    } finally {
      setRunning(false);
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      let local = results;
      if (runnable && (lastRunCode !== code || !results || results.length === 0)) local = await run();
      const res = await submitExerciseAction({
        exerciseId: exercise.id,
        code,
        results: (local ?? []).map((r) => ({ testCaseId: r.testCaseId, passed: r.passed, actualOutput: r.actualOutput ?? "", error: r.error })),
        lessonId,
        courseId,
      });
      if (!res.ok) {
        toast({ title: "Failed to submit. Please try again.", description: res.error, tone: "error" });
        return;
      }
      const saved = res.data.submission;
      setSubmission(saved);
      if (res.data.runnable) setResults(mergeLogs(saved.results, local));
      else setResults(null);
      const summary = res.data.runnable
        ? saved.status === "passed"
          ? "All tests passed."
          : `${saved.passedCount} of ${saved.totalCount} tests passed.`
        : "Your code was saved for instructor review.";
      toast({ title: res.message ?? "Submission saved!", description: summary, tone: saved.status === "passed" ? "success" : res.data.runnable ? "warning" : "info" });
      if (res.data.mismatch) {
        setNotice({ tone: "warning", text: "The server check gave a different result than your browser run. The server result has been saved." });
      } else if (res.data.lessonCompleted) {
        setNotice({ tone: "success", text: "Great work! This lesson is now marked as complete." });
      } else if (!res.data.runnable) {
        setNotice({ tone: "info", text: NOT_RUNNABLE_NOTICE });
      }
    });
  };

  const busy = running || pending;
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon.Code className="size-4 text-ink-muted" />
        <span className="text-sm font-semibold text-ink">{LANGUAGE_LABELS[exercise.language]}</span>
        {submission && <ExerciseStatusBadge status={submission.status} />}
        {dirty && submission && (
          <Badge tone="warning" size="xs">
            Unsubmitted changes
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} disabled={busy || !canSubmit} leftIcon={<Icon.Refresh className="size-4" />}>
          Reset
        </Button>
        {runnable && (
          <Button variant="outline" size="sm" onClick={() => void run()} loading={running} disabled={pending} leftIcon={<Icon.Play className="size-3.5" />}>
            {running ? "Running" : "Run tests"}
          </Button>
        )}
        {canSubmit ? (
          <Button size="sm" onClick={submit} loading={pending} disabled={running} leftIcon={<Icon.Send className="size-4" />}>
            Submit
          </Button>
        ) : (
          <ButtonLink href={loginHref} size="sm" leftIcon={<Icon.LogIn className="size-4" />}>
            Log in to submit
          </ButtonLink>
        )}
      </div>
    </div>
  );

  const notices = (
    <>
      {!runnable && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {NOT_RUNNABLE_NOTICE}
        </p>
      )}
      {exercise.language === "typescript" && (
        <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          <Icon.Info className="mt-0.5 size-4 shrink-0" />
          {TYPESCRIPT_NOTICE}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            notice.tone === "success" && "border-success/30 bg-success/10 text-success",
            notice.tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
            notice.tone === "info" && "border-info/30 bg-info/10 text-info",
          )}
        >
          {notice.tone === "success" ? <Icon.CheckCircle className="mt-0.5 size-4 shrink-0" /> : <Icon.Info className="mt-0.5 size-4 shrink-0" />}
          {notice.text}
        </p>
      )}
    </>
  );

  const workspace = (
    <div className="space-y-4">
      {toolbar}
      {notices}
      <CodeEditor
        value={code}
        onChange={setCode}
        onRun={runnable ? () => void run() : undefined}
        readOnly={!canSubmit}
        language={exercise.language}
        ariaLabel={`${exercise.title} solution`}
        minHeight={variant === "inline" ? 240 : 400}
      />
      {submission && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span>
            Last submitted <LocalDateTime iso={submission.submittedAt} />
          </span>
          <span aria-hidden="true">·</span>
          <Link href={`/exercises/submissions/${submission.id}`} className="font-medium text-accent hover:underline">
            View submission
          </Link>
        </p>
      )}
      <div ref={resultsRef} className="scroll-mt-20">
        <TestResultsList
          results={runnable ? results : submission ? submission.results : null}
          tests={exercise.tests}
          running={running}
          revealHidden={revealHidden}
          emptyText={runnable ? "Please run the code to execute the test cases." : "Tests run after an instructor reviews your submission."}
        />
      </div>
      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setCode(exercise.starterCode);
          setResults(null);
          setLastRunCode(null);
          setConfirmReset(false);
        }}
        title="Reset your code?"
        description="Your editor will go back to the starter code. Your last submission is kept."
        confirmLabel="Reset code"
        destructive
      />
    </div>
  );

  if (variant === "inline") {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
              <Icon.Code className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Programming exercise</p>
              <h3 className="truncate font-semibold text-ink">{exercise.title}</h3>
            </div>
          </div>
          <ButtonLink href={`/exercises/${exercise.id}${lessonQuery(lessonId, courseId)}`} variant="ghost" size="sm" rightIcon={<Icon.ArrowUpRight className="size-4" />}>
            Open full screen
          </ButtonLink>
        </div>
        <div className="space-y-5 p-5">
          <details open className="group rounded-xl border border-border bg-surface-2/40 px-4 py-3">
            <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-ink">
              Problem Statement
              <Icon.ChevronDown className="size-4 text-ink-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3">
              <Markdown content={exercise.problemStatement} />
            </div>
          </details>
          {workspace}
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card className="h-fit p-5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto sm:p-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">Problem Statement</h2>
        <Markdown content={exercise.problemStatement} />
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <Icon.ListChecks className="size-3.5" /> {exercise.tests.length} test{exercise.tests.length === 1 ? "" : "s"}
          </span>
          {exercise.tests.some((t) => t.hidden) && (
            <span className="inline-flex items-center gap-1">
              <Icon.EyeOff className="size-3.5" /> {exercise.tests.filter((t) => t.hidden).length} hidden
            </span>
          )}
          {runnable && (
            <span className="inline-flex items-center gap-1">
              <Icon.Timer className="size-3.5" /> 3s per test
            </span>
          )}
        </div>
      </Card>
      <div className="min-w-0">{workspace}</div>
    </div>
  );
}


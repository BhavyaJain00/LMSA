"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";
import { CodeEditor } from "./code-editor";
import { runTestsInBrowser } from "./js-runner";
import { TestResultsList } from "./test-results";
import { isRunnableLanguage, type RunnerTestCase, type TestResultView } from "./shared";
import type { ExerciseLanguage } from "@/lib/types";

/**
 * Read-only view of a submitted solution with its stored test results and
 * an optional "Re-run in browser" check (useful for reviewers). The re-run
 * always uses the isolated runner (sandboxed iframe with an opaque origin).
 */
export function SubmissionReplay({
  code,
  language,
  storedResults,
  tests,
  revealHidden,
  allowRerun,
}: {
  code: string;
  language: ExerciseLanguage;
  storedResults: TestResultView[];
  tests: RunnerTestCase[];
  revealHidden: boolean;
  allowRerun: boolean;
}) {
  const t = useT("learning");
  const [results, setResults] = useState<TestResultView[]>(storedResults);
  const [running, setRunning] = useState(false);
  const [rerun, setRerun] = useState(false);
  const runnable = isRunnableLanguage(language);

  const run = async () => {
    setRunning(true);
    setResults([]);
    try {
      // Submitted code may not be the viewer's own: run it in an opaque-origin sandbox so it can never
      // make requests with the viewer's session.
      const out = await runTestsInBrowser(code, tests, { isolated: true, onResult: (r) => setResults((prev) => [...prev, r]) });
      setResults(out);
      setRerun(true);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{t("exercise.replay.code")}</h2>
          {allowRerun && runnable && (
            <Button variant="outline" size="sm" onClick={() => void run()} loading={running} leftIcon={<Icon.Play className="size-3.5" />}>
              {running ? t("exercise.running") : t("exercise.replay.rerun")}
            </Button>
          )}
        </div>
        <CodeEditor value={code} readOnly language={language} ariaLabel={t("exercise.replay.code")} minHeight={200} maxHeight={640} showHint={false} />
      </div>
      {rerun && !running && (
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <Icon.Info className="size-3.5" />
          {t("exercise.replay.rerunNote")}
        </p>
      )}
      <TestResultsList results={results} tests={tests} running={running} revealHidden={revealHidden} emptyText={t("exercise.replay.noResults")} />
    </div>
  );
}

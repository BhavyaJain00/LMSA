"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getCourseAiTutorAction, type CourseAiTutorState } from "@/lib/actions/ai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/input";
import { formatNumber } from "@/lib/utils";

export interface CourseAiTutorFieldState {
  status: "loading" | "ready" | "error";
  error: string | null;
  info: CourseAiTutorState | null;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  dirty: boolean;
  retry: () => void;
}

/** Loads the course's "AI tutor" switch and the site/index status shown next to it. */
export function useCourseAiTutorField(courseId: string): CourseAiTutorFieldState {
  const [info, setInfo] = useState<CourseAiTutorState | null>(null);
  const [status, setStatus] = useState<CourseAiTutorFieldState["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getCourseAiTutorAction(courseId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setInfo(result.data);
          setEnabled(result.data.enabled);
          setStatus("ready");
        } else {
          setError(result.error);
          setStatus("error");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("The AI tutor setting could not be loaded. Check your connection and try again.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, attempt]);

  return {
    status,
    error,
    info,
    enabled,
    setEnabled,
    dirty: status === "ready" && !!info && enabled !== info.enabled,
    retry: () => {
      setStatus("loading");
      setError(null);
      setAttempt((n) => n + 1);
    },
  };
}

/**
 * The per-course "AI tutor" switch in the course Settings tab. The marker field
 * tells the server the switch was rendered, so a save from a form that never
 * loaded it leaves the course's setting alone.
 */
export function CourseAiTutorField({ courseId, state }: { courseId: string; state: CourseAiTutorFieldState }) {
  if (state.status === "loading") {
    return (
      <div className="space-y-2" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading the AI tutor setting…</span>
        <div className="h-5 w-40 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-full max-w-md animate-pulse rounded bg-surface-2" />
      </div>
    );
  }
  if (state.status === "error" || !state.info) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm" role="alert">
        <span className="text-danger">{state.error ?? "The AI tutor setting could not be loaded."}</span>
        <Button type="button" size="xs" variant="outline" onClick={state.retry} leftIcon={<Icon.Refresh className="size-3.5" />}>
          Try again
        </Button>
      </div>
    );
  }

  const { info } = state;
  const siteReady = info.siteEnabled && info.keyConfigured;
  const siteProblem = !info.siteEnabled ? "The AI tutor is turned off for the whole site." : !info.keyConfigured ? "The server has no ANTHROPIC_API_KEY yet." : null;

  return (
    <div className="space-y-3">
      <input type="hidden" name="aiTutorField" value="1" />
      <Switch
        name="aiTutorEnabled"
        checked={state.enabled}
        onChange={(e) => state.setEnabled(e.target.checked)}
        label="AI tutor"
        description="Enrolled learners can ask an AI teaching assistant about this course. It answers only from the lessons, transcripts and quiz explanations, links to the lessons it used and never gives away quiz answers."
      />
      {siteProblem && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
          <Icon.AlertCircle className="mt-px size-4 shrink-0 text-warning" />
          <span>
            {siteProblem} Learners won&apos;t see the tutor until it is set up.{" "}
            {info.canConfigureSite ? (
              <Link href="/admin/settings/ai" className="font-medium underline underline-offset-2">
                Open AI tutor settings
              </Link>
            ) : (
              "Ask an administrator to finish the setup."
            )}
          </span>
        </p>
      )}
      {state.enabled && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
          {siteReady && info.enabled ? (
            <Badge tone="success" dot>
              Live for learners
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              {info.enabled ? "Waiting for site setup" : "Turns on when you save"}
            </Badge>
          )}
          <span>
            Indexed {formatNumber(info.index.chunks)} passages from {formatNumber(info.index.lessons)} {info.index.lessons === 1 ? "lesson" : "lessons"}
            {info.index.transcripts ? `, incl. ${formatNumber(info.index.transcripts)} from video transcripts` : ""}
            {info.index.clarifications ? ` and ${formatNumber(info.index.clarifications)} instructor clarifications` : ""}.
          </span>
          <Link href={`/admin/ai?course=${courseId}&tab=recent`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
            Review answers <Icon.ArrowRight className="size-3.5 rtl:rotate-180" />
          </Link>
        </div>
      )}
    </div>
  );
}

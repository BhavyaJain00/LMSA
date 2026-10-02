"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ActionResult } from "@/lib/types";
import { Markdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { submitAssignmentAction, type SubmitAssignmentResult } from "@/lib/actions/assignments";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, FormError, Input } from "@/components/ui/input";
import { FileUpload } from "@/components/ui/file-upload";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";
import { MarkdownEditor } from "./markdown-editor";
import { AssignmentStatusBadge, NotSavedBadge } from "./status-badges";
import { LocalDateTime, useNow } from "./client-time";
import {
  ASSIGNMENT_UPLOAD,
  assignmentScheduleState,
  fileExtension,
  fileNameFromUrl,
  isImageUrl,
  isUploadType,
  type AssignmentSubmissionView,
  type AssignmentView,
} from "./shared";

type SubmitState = ActionResult<SubmitAssignmentResult> | null;

export interface AssignmentPanelProps {
  assignment: AssignmentView;
  submission: AssignmentSubmissionView | null;
  /** Null for guests. */
  viewerName: string | null;
  loginHref: string;
  lessonId?: string;
  courseId?: string;
  variant?: "page" | "inline";
  /** Server time used for the first render of the schedule check. */
  initialNow: number;
  /** Staff can still save outside the schedule window. */
  privileged?: boolean;
  /** Staff shortcut to all submissions of this assignment. */
  manageHref?: string | null;
  /** Standalone page link (shown in the inline variant). */
  pageHref?: string;
}

function Alert({ tone, title, children }: { tone: "warning" | "info" | "success"; title: ReactNode; children?: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm",
        tone === "warning" && "border-warning/30 bg-warning/10",
        tone === "info" && "border-info/30 bg-info/10",
        tone === "success" && "border-success/30 bg-success/10",
      )}
    >
      {tone === "warning" ? (
        <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      ) : tone === "success" ? (
        <Icon.CheckCircle className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <Icon.Info className="mt-0.5 size-4 shrink-0 text-info" />
      )}
      <div className="min-w-0">
        <p className={cn("font-medium", tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-success")}>{title}</p>
        {children && <div className="mt-0.5 text-ink-muted">{children}</div>}
      </div>
    </div>
  );
}

function AttachmentRow({ url }: { url: string }) {
  const t = useT("learning");
  return (
    <div className="space-y-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-ink-muted">
          <Icon.FileText className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{fileNameFromUrl(url)}</span>
        <Icon.ExternalLink className="size-4 shrink-0 text-ink-faint" />
      </a>
      {isImageUrl(url) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={t("assignment.submittedImage")} className="max-h-72 w-auto rounded-xl border border-border object-contain" />
      )}
    </div>
  );
}

export function AssignmentPanel({
  assignment,
  submission: initialSubmission,
  viewerName,
  loginHref,
  lessonId,
  courseId,
  variant = "page",
  initialNow,
  privileged = false,
  manageHref,
  pageHref,
}: AssignmentPanelProps) {
  const t = useT("learning");
  const tc = useT("common");
  const { toast } = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(async (prev, formData) => {
    const res = await submitAssignmentAction(prev, formData);
    if (res.ok) {
      toast({
        title: t("assignment.saved"),
        description: res.data.lessonCompleted && lessonId ? t("assignment.lessonCompleted") : undefined,
        tone: "success",
      });
      // Pull fresh server state: lesson status, course progress, and the model answer (revealed after submitting).
      router.refresh();
    } else {
      toast({ title: res.error, tone: "error" });
    }
    return res;
  }, null);

  const submission = state?.ok ? state.data.submission : initialSubmission;
  const [answer, setAnswer] = useState(initialSubmission?.answer ?? "");
  const [attachment, setAttachment] = useState(initialSubmission?.attachmentUrl ?? "");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const now = useNow(15000, initialNow);
  const schedule = assignmentScheduleState(assignment, now);
  const scheduleBlocked = schedule.blocked && !privileged;
  const loggedIn = viewerName !== null;
  const graded = submission?.status === "pass" || submission?.status === "fail";
  const canModify = loggedIn && !scheduleBlocked && !graded;
  const upload = isUploadType(assignment.type) ? ASSIGNMENT_UPLOAD[assignment.type] : null;

  const savedAnswer = submission?.answer ?? "";
  const savedAttachment = submission?.attachmentUrl ?? "";
  const dirty = upload ? attachment !== savedAttachment : answer.trim() !== savedAnswer.trim();
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  // Ctrl/Cmd+S saves on the full page; inline blocks listen on their own container.
  useEffect(() => {
    if (variant !== "page" || !canModify) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, canModify]);

  const onContainerKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (variant === "inline" && canModify && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  const onUploaded = (url: string, meta?: { name: string }) => {
    setUploadError(null);
    if (!url) {
      setAttachment("");
      return;
    }
    if (!upload) return;
    const ext = fileExtension(meta?.name ?? url) || fileExtension(url);
    if (assignment.type === "image" && ext === ".svg") {
      setUploadError(t("assignment.upload.svgBlocked"));
      return;
    }
    if (!upload.extensions.includes(ext)) {
      setUploadError(t(`assignment.upload.error.${upload.kind === "image" ? "image" : assignment.type === "pdf" ? "pdf" : "document"}`));
      return;
    }
    setAttachment(url);
  };

  const scheduleAlert = schedule.blocked ? (
    <Alert
      tone="warning"
      title={
        schedule.reason === "not_started" && assignment.scheduleStart
          ? t.rich("assignment.schedule.opensOn", { time: <LocalDateTime iso={assignment.scheduleStart} /> })
          : t("assignment.schedule.ended")
      }
    >
      {privileged ? t("assignment.schedule.managerBypass") : null}
    </Alert>
  ) : assignment.enableScheduling && assignment.scheduleEnd ? (
    <p className="flex items-center gap-1.5 text-xs text-ink-muted">
      <Icon.Clock className="size-3.5" />
      <span>{t.rich("assignment.schedule.closesOn", { time: <LocalDateTime iso={assignment.scheduleEnd} /> })}</span>
    </p>
  ) : null;

  const answerArea = (() => {
    if (upload) {
      if (canModify) {
        return (
          <div className="space-y-2 rounded-xl border border-border p-4">
            <div>
              <p className="text-sm font-medium text-ink">{t("assignment.upload.title")}</p>
              <p className="text-xs text-ink-muted">{t("assignment.upload.only", { type: t(`global.assess.type.${assignment.type}`) })}</p>
            </div>
            <FileUpload
              name="attachmentUrl"
              value={attachment}
              onChange={onUploaded}
              kind={upload.kind}
              accept={upload.accept}
              preview={assignment.type === "image"}
            />
            {(uploadError || fieldErrors?.attachmentUrl) && <p className="text-xs text-danger">{uploadError ?? fieldErrors?.attachmentUrl}</p>}
          </div>
        );
      }
      return savedAttachment ? <AttachmentRow url={savedAttachment} /> : null;
    }
    if (assignment.type === "url") {
      if (!canModify && submission?.answer) {
        return (
          <div className="rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-sm">
            <a href={submission.answer} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 break-all font-medium text-accent hover:underline">
              <Icon.Link className="size-4 shrink-0" />
              {submission.answer}
            </a>
          </div>
        );
      }
      return (
        <Field label={t("assignment.urlLabel")} htmlFor={`asg-url-${assignment.id}`} error={fieldErrors?.answer}>
          <Input
            id={`asg-url-${assignment.id}`}
            name="answer"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={!canModify}
            invalid={!!fieldErrors?.answer}
            leftAddon={<Icon.Link className="size-4" />}
          />
        </Field>
      );
    }
    // Text
    if (!canModify && submission?.answer) {
      return (
        <div className="rounded-xl border border-border bg-surface-2/40 px-4 py-3">
          <Markdown content={submission.answer} />
        </div>
      );
    }
    return (
      <div>
        <label htmlFor={`asg-text-${assignment.id}`} className="mb-1.5 block text-sm font-medium text-ink">
          {t("assignment.textLabel")}
        </label>
        <MarkdownEditor
          id={`asg-text-${assignment.id}`}
          name="answer"
          value={answer}
          onChange={setAnswer}
          rows={variant === "inline" ? 6 : 9}
          disabled={!canModify}
          invalid={!!fieldErrors?.answer}
          placeholder={t("assignment.textPlaceholder")}
        />
        {fieldErrors?.answer && <p className="mt-1.5 text-xs text-danger">{fieldErrors.answer}</p>}
      </div>
    );
  })();

  const form = (
    <form ref={formRef} action={formAction} onKeyDown={onContainerKeyDown} className="space-y-4" noValidate>
      <input type="hidden" name="assignmentId" value={assignment.id} />
      {lessonId && <input type="hidden" name="lessonId" value={lessonId} />}
      {courseId && <input type="hidden" name="courseId" value={courseId} />}

      {scheduleAlert}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-ink">{t("assignment.submission")}</h3>
          {loggedIn && canModify && dirty && (submission || answer || attachment) ? (
            <NotSavedBadge />
          ) : submission ? (
            <AssignmentStatusBadge status={submission.status} size="md" />
          ) : null}
        </div>
        {loggedIn ? (
          canModify && (
            <Tooltip label={t("assignment.saveShortcut")}>
              <Button type="submit" loading={pending} disabled={!dirty && !!submission} leftIcon={<Icon.Check className="size-4" />}>
                {submission ? tc("actions.save") : tc("actions.submit")}
              </Button>
            </Tooltip>
          )
        ) : (
          <ButtonLink href={loginHref} leftIcon={<Icon.LogIn className="size-4 rtl:-scale-x-100" />}>
            {t("assignment.loginToSubmit")}
          </ButtonLink>
        )}
      </div>

      {state && !state.ok && !state.fieldErrors && <FormError message={state.error} />}

      {submission && submission.status === "not_graded" && canModify && (
        <Alert tone="info" title={t("assignment.submittedTitle")}>
          {t("assignment.submittedBody")}
        </Alert>
      )}
      {submission && submission.status === "not_applicable" && (
        <Alert tone="success" title={t("assignment.receivedTitle")}>
          {canModify ? t("assignment.ungradedEditable") : t("assignment.ungraded")}
        </Alert>
      )}
      {graded && (
        <Alert tone={submission?.status === "pass" ? "success" : "warning"} title={submission?.status === "pass" ? t("assignment.passedTitle") : t("assignment.failedTitle")}>
          {t("assignment.gradedLocked")}
        </Alert>
      )}

      {loggedIn || !upload ? answerArea : null}

      {submission && !scheduleBlocked && !canModify && !submission.answer && !submission.attachmentUrl && (
        <p className="text-sm italic text-ink-muted">{t("assignment.noAnswer")}</p>
      )}

      {submission?.comments && (
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <p className="mb-2 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink">
            <Icon.MessageSquare className="size-4 text-ink-muted" />
            {t("assignment.evaluatorComments")}
            {submission.evaluatorName && <span className="font-normal text-ink-muted">· {submission.evaluatorName}</span>}
          </p>
          <Markdown content={submission.comments} className="text-sm" />
        </div>
      )}

      {submission && assignment.showAnswer && assignment.answer && (
        <details className="group rounded-xl border border-success/30 bg-success/5 px-4 py-3">
          <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-ink">
            <span className="flex items-center gap-2">
              <Icon.Sparkles className="size-4 text-success" /> {t("assignment.modelAnswer")}
            </span>
            <Icon.ChevronDown className="size-4 text-ink-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3">
            <Markdown content={assignment.answer} />
          </div>
        </details>
      )}

      {manageHref && (
        <p className="border-t border-border pt-3 text-xs text-ink-muted">
          {t.rich("assignment.manage", {
            link: (text) => (
              <Link href={manageHref} className="font-medium text-accent hover:underline">
                {text}
              </Link>
            ),
          })}
        </p>
      )}
    </form>
  );

  if (variant === "inline") {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
              <Icon.ClipboardList className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("assignment.eyebrow", { type: t(`global.assess.type.${assignment.type}`) })}</p>
              <h3 className="truncate font-semibold text-ink">{assignment.title}</h3>
            </div>
          </div>
          {pageHref && (
            <ButtonLink href={pageHref} variant="ghost" size="sm" rightIcon={<Icon.ArrowUpRight className="size-4 rtl:-scale-x-100" />}>
              {t("assignment.openPage")}
            </ButtonLink>
          )}
        </div>
        <div className="space-y-5 p-5">
          <details open className="group rounded-xl border border-border bg-surface-2/40 px-4 py-3">
            <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-ink">
              {t("assignment.question")}
              <Icon.ChevronDown className="size-4 text-ink-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3">
              <Markdown content={assignment.question} />
            </div>
          </details>
          {form}
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="h-fit p-5 sm:p-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        {viewerName && <h2 className="text-lg font-semibold text-ink">{t("assignment.submissionBy", { name: viewerName })}</h2>}
        <p className={cn("text-sm font-semibold text-ink", viewerName && "mt-1")}>{t("assignment.titleLabel", { title: assignment.title })}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="outline">{t(`global.assess.type.${assignment.type}`)}</Badge>
          {!assignment.gradeAssignment && <Badge tone="neutral">{t("assignment.notGraded")}</Badge>}
          {assignment.enableScheduling && assignment.scheduleStart && (
            <Badge tone="neutral">
              <Icon.Calendar className="size-3" />
              {t.rich("assignment.opensBadge", { date: <LocalDateTime iso={assignment.scheduleStart} mode="date" /> })}
            </Badge>
          )}
        </div>
        <div className="mt-5 border-t border-border pt-5">
          <Markdown content={assignment.question} />
        </div>
      </Card>
      <Card className="h-fit p-5 sm:p-6">{form}</Card>
    </div>
  );
}

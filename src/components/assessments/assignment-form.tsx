"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import type { ActionResult, AssignmentType } from "@/lib/types";
import { deleteAssignmentsAction, saveAssignmentAction } from "@/lib/actions/assignments";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormError, Input, Select, Switch } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { MarkdownEditor } from "./markdown-editor";
import { NotSavedBadge } from "./status-badges";
import { useIsClient } from "./client-time";
import { ASSIGNMENT_TYPE_OPTIONS } from "./shared";
import { submitWithoutReset } from "./form-submit";

export interface AssignmentFormValues {
  id: string;
  title: string;
  type: AssignmentType;
  courseId?: string;
  question: string;
  enableScheduling: boolean;
  scheduleStart?: string;
  scheduleEnd?: string;
  showAnswer: boolean;
  answer?: string;
  gradeAssignment: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

function isoToLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Datetime inputs in the author's own time zone, submitted as ISO instants. Client-only. */
function ScheduleFields({
  initialStart,
  initialEnd,
  visible,
  errors,
}: {
  initialStart?: string;
  initialEnd?: string;
  visible: boolean;
  errors?: Record<string, string>;
}) {
  const [start, setStart] = useState(() => isoToLocalInput(initialStart));
  const [end, setEnd] = useState(() => isoToLocalInput(initialEnd));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className={visible ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
      <input type="hidden" name="scheduleStart" value={localInputToIso(start)} />
      <input type="hidden" name="scheduleEnd" value={localInputToIso(end)} />
      <Field label="Schedule Start" htmlFor="asg-start" required error={errors?.scheduleStart} hint={`Times are in your time zone (${tz}).`}>
        <Input id="asg-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} invalid={!!errors?.scheduleStart} />
      </Field>
      <Field label="Schedule End" htmlFor="asg-end" error={errors?.scheduleEnd} hint="Optional. Leave empty to keep the assignment open after it starts.">
        <Input id="asg-end" type="datetime-local" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} invalid={!!errors?.scheduleEnd} />
      </Field>
    </div>
  );
}

export function AssignmentForm({
  assignment,
  courseOptions,
  defaultCourseId,
}: {
  assignment: AssignmentFormValues | null;
  courseOptions: { value: string; label: string }[];
  defaultCourseId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const isClient = useIsClient();
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(saveAssignmentAction, null);
  const [dirty, setDirty] = useState(false);
  const [scheduling, setScheduling] = useState(assignment?.enableScheduling ?? false);
  const [showAnswer, setShowAnswer] = useState(assignment?.showAnswer ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const editing = !!assignment;

  return (
    <form onSubmit={submitWithoutReset(formAction)} onChange={() => setDirty(true)} className="space-y-6" noValidate>
      {assignment && <input type="hidden" name="id" value={assignment.id} />}
      <FormError message={state && !state.ok ? state.error : null} />

      <Card>
        <CardHeader
          title={editing ? "Edit Assignment" : "Create an Assignment"}
          description="Learners see the question and submit a file, a link or a written answer."
          actions={dirty ? <NotSavedBadge /> : undefined}
        />
        <CardBody className="space-y-5">
          <Field label="Title" htmlFor="asg-title" required error={errors?.title}>
            <Input id="asg-title" name="title" defaultValue={assignment?.title} maxLength={200} placeholder="e.g. Build a To-Do App" invalid={!!errors?.title} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Submission Type" htmlFor="asg-type" required error={errors?.type} hint="What learners hand in.">
              <Select id="asg-type" name="type" defaultValue={assignment?.type ?? "pdf"} options={ASSIGNMENT_TYPE_OPTIONS} invalid={!!errors?.type} />
            </Field>
            <Field label="Course" htmlFor="asg-course" error={errors?.courseId} hint="Optional. Links submissions to a course.">
              <Select id="asg-course" name="courseId" defaultValue={assignment?.courseId ?? defaultCourseId ?? ""} invalid={!!errors?.courseId}>
                <option value="">No course</option>
                {courseOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div>
            <label htmlFor="asg-question" className="mb-1.5 block text-sm font-medium text-ink">
              Question<span className="ml-0.5 text-danger">*</span>
            </label>
            <MarkdownEditor
              id="asg-question"
              name="question"
              defaultValue={assignment?.question ?? ""}
              rows={10}
              invalid={!!errors?.question}
              placeholder="Describe the task, the requirements and how it will be graded."
              onChange={() => setDirty(true)}
            />
            {errors?.question && <p className="mt-1.5 text-xs text-danger">{errors.question}</p>}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Grading & schedule" />
        <CardBody className="space-y-5">
          <Switch
            name="gradeAssignment"
            id="asg-grade"
            defaultChecked={assignment?.gradeAssignment ?? true}
            label="Grade Assignment"
            description="Evaluators mark submissions Pass or Fail and leave comments. Turn off for ungraded practice (status Not applicable)."
          />
          {!editing && (
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <Icon.Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Once the assignment is created, open it again to grade with a rubric or turn on peer review.
            </p>
          )}
          <div className="space-y-4 border-t border-border pt-5">
            <Switch
              name="enableScheduling"
              id="asg-scheduling"
              checked={scheduling}
              onChange={(e) => setScheduling(e.target.checked)}
              label="Enable Scheduling"
              description="Restrict when learners can submit this assignment."
            />
            {isClient ? (
              <ScheduleFields initialStart={assignment?.scheduleStart} initialEnd={assignment?.scheduleEnd} visible={scheduling} errors={errors} />
            ) : (
              scheduling && <div className="h-16 rounded-lg bg-surface-2" aria-hidden="true" />
            )}
          </div>
          <div className="space-y-4 border-t border-border pt-5">
            <Switch
              name="showAnswer"
              id="asg-show-answer"
              checked={showAnswer}
              onChange={(e) => setShowAnswer(e.target.checked)}
              label="Show Answer"
              description="Reveal a model answer to learners after they submit."
            />
            <div className={showAnswer ? "" : "hidden"}>
              <label htmlFor="asg-answer" className="mb-1.5 block text-sm font-medium text-ink">
                Model answer
              </label>
              <MarkdownEditor
                id="asg-answer"
                name="answer"
                defaultValue={assignment?.answer ?? ""}
                rows={6}
                invalid={!!errors?.answer}
                placeholder="What a strong submission looks like."
                onChange={() => setDirty(true)}
              />
              {errors?.answer && <p className="mt-1.5 text-xs text-danger">{errors.answer}</p>}
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {assignment && (
            <>
              <Button type="button" variant="outline" className="text-danger" onClick={() => setConfirmDelete(true)} leftIcon={<Icon.Trash className="size-4" />}>
                Delete
              </Button>
              <ButtonLink href={`/admin/assignments/submissions?assignment=${assignment.id}`} variant="outline" leftIcon={<Icon.ClipboardList className="size-4" />}>
                Check Submissions
              </ButtonLink>
              <ButtonLink href={`/assignments/${assignment.id}`} variant="ghost" leftIcon={<Icon.Eye className="size-4" />}>
                Preview
              </ButtonLink>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Link href="/admin/assignments" className="inline-flex h-9.5 items-center rounded-lg px-4 text-sm font-medium text-ink hover:bg-surface-2">
            Cancel
          </Link>
          <Button type="submit" loading={pending} leftIcon={<Icon.Check className="size-4" />}>
            Save
          </Button>
        </div>
      </div>

      {assignment && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this assignment?"
          description="The assignment and all of its submissions will be permanently removed. Lessons that embed it will show it as unavailable."
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={() =>
            startDelete(async () => {
              const res = await deleteAssignmentsAction([assignment.id]);
              if (!res.ok) {
                toast({ title: res.error, tone: "error" });
                return;
              }
              toast({ title: "Assignment deleted successfully", tone: "success" });
              setConfirmDelete(false);
              router.push("/admin/assignments");
            })
          }
        />
      )}
    </form>
  );
}

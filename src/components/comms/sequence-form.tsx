"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ActionResult, SequenceTrigger } from "@/lib/types";
import { saveSequenceAction } from "@/lib/actions/sequences";
import { CONTENT_LIMITS } from "@/lib/comms/campaign-core";
import {
  GOAL_LABELS,
  SEQUENCE_LIMITS,
  TRIGGER_GOALS,
  TRIGGER_OPTIONS,
  type DelayUnit,
  type SequenceGoal,
  cumulativeDelayHours,
  defaultGoal,
  formatDelay,
  joinDelay,
  splitDelay,
} from "@/lib/comms/sequence-core";
import { MarkdownEditor } from "@/components/admin/courses/markdown-editor";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Checkbox, Field, FormError, Input, RadioCard, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CourseChoice } from "./course-multi-select";
import { LiveEmailPreview } from "./live-email-preview";
import { PlaceholderBar, insertAtCaret } from "./placeholder-bar";

export interface SequenceFormStep {
  /** Set for emails that already exist (keeps their statistics and people's place in the sequence). */
  id?: string;
  delayHours: number;
  subject: string;
  body: string;
}

export interface SequenceFormValues {
  id?: string;
  name: string;
  description?: string;
  trigger: SequenceTrigger;
  courseId?: string;
  inactiveDays?: number;
  goal: SequenceGoal;
  steps: SequenceFormStep[];
}

interface StepState {
  /** Stable React key (the step id, or a local one for new emails). */
  key: string;
  id?: string;
  delayValue: string;
  delayUnit: DelayUnit;
  subject: string;
  body: string;
}

const TRIGGER_ICONS: Record<SequenceTrigger, ReactNode> = {
  signup: <Icon.UserPlus className="size-4" />,
  lead: <Icon.Inbox className="size-4" />,
  enrollment: <Icon.GraduationCap className="size-4" />,
  purchase: <Icon.CreditCard className="size-4" />,
  inactive: <Icon.Clock className="size-4" />,
};

function toState(step: SequenceFormStep, key: string): StepState {
  const delay = splitDelay(step.delayHours);
  return { key, id: step.id, delayValue: String(delay.value), delayUnit: delay.unit, subject: step.subject, body: step.body };
}

function hoursOf(step: Pick<StepState, "delayValue" | "delayUnit">): number {
  return joinDelay(Number(step.delayValue), step.delayUnit);
}

/**
 * Create or edit an automated email sequence: what starts it, what ends it
 * early, and the emails with their delays. The emails are submitted as JSON;
 * the server validates everything again.
 */
export function SequenceForm({
  courses,
  initial,
  activePeople = 0,
}: {
  courses: CourseChoice[];
  initial: SequenceFormValues;
  /** People part-way through the sequence (edit mode): shown as a heads-up. */
  activePeople?: number;
}) {
  const uid = useId();
  const formId = `${uid}-form`;
  const editing = !!initial.id;
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveSequenceAction, null);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [trigger, setTrigger] = useState<SequenceTrigger>(initial.trigger);
  const [courseId, setCourseId] = useState(initial.courseId ?? "");
  const [inactiveDays, setInactiveDays] = useState(String(initial.inactiveDays ?? 30));
  const [goal, setGoal] = useState<SequenceGoal>(initial.goal);
  const [steps, setSteps] = useState<StepState[]>(() => initial.steps.map((step, i) => toState(step, step.id ?? `initial-${i}`)));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(editing && initial.steps.length > 2 ? initial.steps.map((s, i) => s.id ?? `initial-${i}`) : []));
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [activate, setActivate] = useState(false);
  const [dirty, setDirty] = useState(false);
  const counter = useRef(0);
  const lastField = useRef<{ key: string; field: "subject" | "body" } | null>(null);

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const triggerOption = TRIGGER_OPTIONS.find((t) => t.value === trigger)!;
  const goals = TRIGGER_GOALS[trigger];
  const offsets = cumulativeDelayHours(steps.map((s) => ({ delayHours: hoursOf(s) })));
  const atLimit = steps.length >= SEQUENCE_LIMITS.steps;

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  const touch = () => setDirty(true);
  const fieldId = (key: string, field: string) => `${uid}-${key}-${field}`;

  const chooseTrigger = (value: string) => {
    const next = value as SequenceTrigger;
    setTrigger(next);
    if (!TRIGGER_GOALS[next].includes(goal)) setGoal(defaultGoal(next));
    touch();
  };

  const patchStep = (key: string, patch: Partial<StepState>) => {
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    touch();
  };

  const addStep = (copyOf?: StepState) => {
    const key = `new-${++counter.current}`;
    const step: StepState = copyOf
      ? { ...copyOf, key, id: undefined }
      : { key, delayValue: steps.length === 0 ? "0" : "2", delayUnit: steps.length === 0 ? "hours" : "days", subject: "", body: "" };
    setSteps((list) => {
      if (!copyOf) return [...list, step];
      const at = list.findIndex((s) => s.key === copyOf.key);
      return [...list.slice(0, at + 1), step, ...list.slice(at + 1)];
    });
    touch();
    // Bring the new email's subject into view once it is rendered.
    requestAnimationFrame(() => document.getElementById(fieldId(key, "subject"))?.focus());
  };

  const removeStep = (key: string) => {
    setSteps((list) => list.filter((s) => s.key !== key));
    if (previewing === key) setPreviewing(null);
    touch();
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps((list) => {
      const target = index + direction;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    touch();
  };

  const toggleCollapsed = (key: string) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const insert = (step: StepState, token: string) => {
    const field = lastField.current?.key === step.key ? lastField.current.field : "body";
    const value = insertAtCaret(fieldId(step.key, field), step[field], token);
    patchStep(step.key, field === "subject" ? { subject: value } : { body: value });
  };

  const stepsJson = JSON.stringify(steps.map((s) => ({ id: s.id ?? "", delayHours: hoursOf(s), subject: s.subject, body: s.body })));

  return (
    <div className="space-y-5">
      <form id={formId} action={action}>
        {initial.id && <input type="hidden" name="id" value={initial.id} />}
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="trigger" value={trigger} />
        <input type="hidden" name="courseId" value={triggerOption.course ? courseId : ""} />
        <input type="hidden" name="inactiveDays" value={trigger === "inactive" ? inactiveDays : ""} />
        <input type="hidden" name="goal" value={goal} />
        <input type="hidden" name="steps" value={stepsJson} />
        {activate && <input type="hidden" name="activate" value="on" />}
      </form>

      {editing && activePeople > 0 && (
        <p role="status" className="flex gap-2 rounded-card border border-info/30 bg-info/10 p-3 text-sm text-info">
          <Icon.Info className="mt-0.5 size-4 shrink-0" />
          <span>
            {activePeople.toLocaleString("en-US")} {activePeople === 1 ? "person is" : "people are"} part-way through this sequence. They receive the emails as you save them here and keep
            their place, even when you reorder the emails.
          </span>
        </p>
      )}

      <Card className="min-w-0 space-y-5 p-5">
        <h2 className="text-base font-semibold text-ink">Basics</h2>
        <Field label="Name" htmlFor={`${uid}-name`} required error={errors.name} hint="Only your team sees this.">
          <Input
            id={`${uid}-name`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              touch();
            }}
            maxLength={SEQUENCE_LIMITS.name}
            invalid={!!errors.name}
            placeholder="Welcome series"
            autoComplete="off"
          />
        </Field>
        <Field label="Note" htmlFor={`${uid}-description`} error={errors.description} hint="Optional: what this sequence is for.">
          <Textarea
            id={`${uid}-description`}
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              touch();
            }}
            maxLength={SEQUENCE_LIMITS.description}
            invalid={!!errors.description}
          />
        </Field>
      </Card>

      <Card className="min-w-0 space-y-5 p-5">
        <div>
          <h2 className="text-base font-semibold text-ink">Trigger</h2>
          <p className="mt-0.5 text-sm text-ink-muted">What starts the sequence for a person. Each person goes through it once per trigger.</p>
        </div>
        <fieldset>
          <legend className="sr-only">What starts the sequence</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TRIGGER_OPTIONS.map((option) => (
              <RadioCard
                key={option.value}
                name={`${uid}-trigger`}
                value={option.value}
                checked={trigger === option.value}
                onChange={chooseTrigger}
                title={option.label}
                description={option.description}
                icon={TRIGGER_ICONS[option.value]}
              />
            ))}
          </div>
          {errors.trigger && <p className="mt-1.5 text-xs text-danger">{errors.trigger}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {triggerOption.course && (
            <Field
              label="Course"
              htmlFor={`${uid}-course`}
              error={errors.courseId}
              hint={trigger === "lead" ? "Only leads who signed up from this course's page." : "Leave on “Any course” to start it for every course."}
            >
              <Select
                id={`${uid}-course`}
                value={courseId}
                onChange={(e) => {
                  setCourseId(e.target.value);
                  touch();
                }}
                invalid={!!errors.courseId}
                options={[{ value: "", label: trigger === "lead" ? "Any lead" : "Any course" }, ...courses.map((c) => ({ value: c.id, label: c.published ? c.title : `${c.title} (unpublished)` }))]}
              />
            </Field>
          )}
          {trigger === "inactive" && (
            <Field
              label="Days without activity"
              htmlFor={`${uid}-inactive`}
              required
              error={errors.inactiveDays}
              hint="Counted from the member's last sign-in or lesson. Members who were already away this long when you switch the sequence on are not emailed."
            >
              <Input
                id={`${uid}-inactive`}
                type="number"
                inputMode="numeric"
                min={1}
                max={SEQUENCE_LIMITS.maxInactiveDays}
                value={inactiveDays}
                onChange={(e) => {
                  setInactiveDays(e.target.value);
                  touch();
                }}
                invalid={!!errors.inactiveDays}
                rightAddon={<span className="text-xs text-ink-muted">days</span>}
              />
            </Field>
          )}
          <Field label="Goal" htmlFor={`${uid}-goal`} hint={GOAL_LABELS[goal].description}>
            <Select
              id={`${uid}-goal`}
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value as SequenceGoal);
                touch();
              }}
              options={goals.map((g) => ({ value: g, label: GOAL_LABELS[g].label }))}
            />
          </Field>
        </div>
        <p className="flex gap-2 rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">
          <Icon.ShieldCheck className="size-4 shrink-0 text-success" />
          <span>The sequence always stops for people who unsubscribe or can no longer be emailed, and every email carries the recipient&apos;s own unsubscribe link.</span>
        </p>
      </Card>

      <section aria-labelledby={`${uid}-emails`} className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id={`${uid}-emails`} className="text-base font-semibold text-ink">
              Emails
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">Each delay counts from the moment the previous email was sent (the first one from the trigger).</p>
          </div>
          <span className="text-xs tabular-nums text-ink-muted">
            {steps.length}/{SEQUENCE_LIMITS.steps}
          </span>
        </div>
        {errors.steps && <FormError message={errors.steps} />}

        {steps.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-strong px-4 py-10 text-center">
            <p className="text-sm font-medium text-ink">No emails yet</p>
            <p className="mt-1 text-xs text-ink-muted">Add the first email of the sequence.</p>
          </div>
        ) : (
          <ol className="space-y-3">
            {steps.map((step, index) => {
              const subjectError = errors[`steps.${index}.subject`];
              const bodyError = errors[`steps.${index}.body`];
              const delayError = errors[`steps.${index}.delayHours`];
              const hasError = !!(subjectError || bodyError || delayError);
              const open = !collapsed.has(step.key) || hasError;
              const panelId = fieldId(step.key, "panel");
              return (
                <li key={step.key}>
                  <Card className={cn("min-w-0", hasError && "border-danger/50")}>
                    <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(step.key)}
                        aria-expanded={open}
                        aria-controls={panelId}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{step.subject.trim() || `Email ${index + 1}`}</span>
                          <span className="block truncate text-xs text-ink-muted">
                            {offsets[index] === 0 ? "Sent right after the trigger" : `Sent ${formatDelay(offsets[index] ?? 0)} after the trigger`}
                          </span>
                        </span>
                        <Icon.ChevronDown className={cn("size-4 shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
                      </button>
                      <div className="flex shrink-0 items-center">
                        <IconButton label={`Move email ${index + 1} up`} size="icon-sm" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                          <Icon.ChevronUp className="size-4" />
                        </IconButton>
                        <IconButton label={`Move email ${index + 1} down`} size="icon-sm" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>
                          <Icon.ChevronDown className="size-4" />
                        </IconButton>
                        <IconButton label={`Duplicate email ${index + 1}`} size="icon-sm" disabled={atLimit} onClick={() => addStep(step)} className="hidden sm:inline-flex">
                          <Icon.Copy className="size-4" />
                        </IconButton>
                        <IconButton label={`Remove email ${index + 1}`} size="icon-sm" onClick={() => removeStep(step.key)} className="text-danger">
                          <Icon.Trash className="size-4" />
                        </IconButton>
                      </div>
                    </div>

                    {open && (
                      <div id={panelId} className="space-y-4 border-t border-border p-4 sm:p-5">
                        <div>
                          <label htmlFor={fieldId(step.key, "delay")} className="mb-1.5 block text-sm font-medium text-ink">
                            Wait before sending
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              id={fieldId(step.key, "delay")}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={step.delayValue}
                              onChange={(e) => patchStep(step.key, { delayValue: e.target.value })}
                              invalid={!!delayError}
                              className="w-24"
                            />
                            <div className="w-28">
                              <Select
                                aria-label="Delay unit"
                                value={step.delayUnit}
                                onChange={(e) => patchStep(step.key, { delayUnit: e.target.value as DelayUnit })}
                                options={[
                                  { value: "hours", label: "hours" },
                                  { value: "days", label: "days" },
                                ]}
                              />
                            </div>
                            <span className="text-sm text-ink-muted">{index === 0 ? "after the trigger" : `after email ${index}`}</span>
                          </div>
                          {delayError ? <p className="mt-1.5 text-xs text-danger">{delayError}</p> : <p className="mt-1.5 text-xs text-ink-muted">Use 0 to send it right away.</p>}
                        </div>

                        <Field label="Subject" htmlFor={fieldId(step.key, "subject")} required error={subjectError}>
                          <Input
                            id={fieldId(step.key, "subject")}
                            value={step.subject}
                            onChange={(e) => patchStep(step.key, { subject: e.target.value })}
                            onFocus={() => (lastField.current = { key: step.key, field: "subject" })}
                            maxLength={CONTENT_LIMITS.subject}
                            invalid={!!subjectError}
                            autoComplete="off"
                          />
                        </Field>

                        <div>
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <label htmlFor={fieldId(step.key, "body")} className="block text-sm font-medium text-ink">
                              Message<span className="ml-0.5 text-danger">*</span>
                            </label>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setPreviewing(previewing === step.key ? null : step.key)}
                              aria-pressed={previewing === step.key}
                              leftIcon={previewing === step.key ? <Icon.Edit className="size-3.5" /> : <Icon.Eye className="size-3.5" />}
                            >
                              {previewing === step.key ? "Back to writing" : "Email preview"}
                            </Button>
                          </div>
                          {previewing === step.key ? (
                            step.body.trim() ? (
                              <LiveEmailPreview kind="sequence" subject={step.subject} body={step.body} courseId={triggerOption.course ? courseId : undefined} heightClass="h-[420px] max-h-[60vh]" />
                            ) : (
                              <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-ink-muted">Write a message to see how the email will look.</p>
                            )
                          ) : (
                            <>
                              <div onFocusCapture={() => (lastField.current = { key: step.key, field: "body" })}>
                                <MarkdownEditor
                                  id={fieldId(step.key, "body")}
                                  value={step.body}
                                  onChange={(value) => patchStep(step.key, { body: value })}
                                  rows={9}
                                  invalid={!!bodyError}
                                  placeholder={"Hi {{ first_name }},\n\nWrite your message in Markdown…"}
                                />
                              </div>
                              <PlaceholderBar kind="sequence" onInsert={(token) => insert(step, token)} className="mt-2" />
                            </>
                          )}
                          {bodyError && <p className="mt-1.5 text-xs text-danger">{bodyError}</p>}
                        </div>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}

        <Button variant="outline" onClick={() => addStep()} disabled={atLimit} leftIcon={<Icon.Plus className="size-4" />}>
          Add an email
        </Button>
        {atLimit && <p className="text-xs text-ink-muted">A sequence can have at most {SEQUENCE_LIMITS.steps} emails.</p>}
      </section>

      <div className="space-y-3 border-t border-border pt-5">
        {state && !state.ok && <FormError message={state.error} />}
        {!editing && (
          <Checkbox
            id={`${uid}-activate`}
            checked={activate}
            onChange={(e) => setActivate(e.target.checked)}
            label="Switch the sequence on right away"
            description="Otherwise it is saved switched off, and you can send yourself test emails first."
          />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <ButtonLink href={initial.id ? `/admin/sequences/${initial.id}` : "/admin/sequences"} variant="outline">
            Cancel
          </ButtonLink>
          <Button type="submit" form={formId} loading={pending}>
            {editing ? "Save changes" : "Create sequence"}
          </Button>
        </div>
      </div>
    </div>
  );
}

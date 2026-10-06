"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { ActionResult, SegmentFilter } from "@/lib/types";
import { saveBroadcastAction } from "@/lib/actions/broadcasts";
import { CONTENT_LIMITS } from "@/lib/comms/campaign-core";
import { normalizeSegmentFilter } from "@/lib/comms/segments";
import { MarkdownEditor } from "@/components/admin/courses/markdown-editor";
import { LocalDateTime } from "@/components/assessments/client-time";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import type { CourseChoice } from "./course-multi-select";
import { LiveEmailPreview } from "./live-email-preview";
import { PlaceholderBar, insertAtCaret } from "./placeholder-bar";
import { SegmentBuilder } from "./segment-builder";

export interface ComposerBroadcast {
  id: string;
  subject: string;
  preheader: string;
  body: string;
  segment: SegmentFilter;
  /** Set when the broadcast is scheduled (it stays scheduled after an edit). */
  scheduledAt?: string;
}

type FieldName = "subject" | "preheader" | "body";

/**
 * Broadcast composer: subject, inbox preview text and a markdown message
 * with personalization placeholders, a live preview of the finished email,
 * and the audience builder. Saving opens the review page, where the
 * broadcast is tested, scheduled or sent.
 */
export function BroadcastComposer({
  courses,
  broadcast,
  initialSegment,
  segmentNotice,
}: {
  courses: CourseChoice[];
  broadcast?: ComposerBroadcast;
  initialSegment?: SegmentFilter;
  /** Shown above the audience builder, e.g. when deleted courses dropped out of a saved audience. */
  segmentNotice?: string;
}) {
  const uid = useId();
  const formId = `${uid}-form`;
  const ids: Record<FieldName, string> = { subject: `${uid}-subject`, preheader: `${uid}-preheader`, body: `${uid}-body` };
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveBroadcastAction, null);
  const [subject, setSubject] = useState(broadcast?.subject ?? "");
  const [preheader, setPreheader] = useState(broadcast?.preheader ?? "");
  const [body, setBody] = useState(broadcast?.body ?? "");
  const [segment, setSegment] = useState<SegmentFilter>(() => normalizeSegmentFilter(broadcast?.segment ?? initialSegment ?? {}));
  const [view, setView] = useState<"write" | "preview">("write");
  const [dirty, setDirty] = useState(false);
  const lastField = useRef<FieldName>("body");
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  // Warn before leaving with unsaved changes (not while the form is being submitted).
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  const setters: Record<FieldName, (value: string) => void> = { subject: setSubject, preheader: setPreheader, body: setBody };
  const values: Record<FieldName, string> = { subject, preheader, body };
  const change = (field: FieldName, value: string) => {
    setters[field](value);
    setDirty(true);
  };
  const insert = (token: string) => {
    const field = lastField.current;
    change(field, insertAtCaret(ids[field], values[field], token));
  };

  return (
    <div className="space-y-5">
      <form id={formId} action={action}>
        {broadcast && <input type="hidden" name="id" value={broadcast.id} />}
        <input type="hidden" name="subject" value={subject} />
        <input type="hidden" name="preheader" value={preheader} />
        <input type="hidden" name="body" value={body} />
        <input type="hidden" name="segment" value={JSON.stringify(segment)} />
      </form>

      {broadcast?.scheduledAt && (
        <p role="status" className="flex gap-2 rounded-card border border-info/30 bg-info/10 p-3 text-sm text-info">
          <Icon.Clock className="mt-0.5 size-4 shrink-0" />
          <span>
            This broadcast is scheduled for <LocalDateTime iso={broadcast.scheduledAt} mode="weekday-datetime" />. Your changes are saved and sent at that time.
          </span>
        </p>
      )}

      <Card className="min-w-0 p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <h2 className="text-base font-semibold text-ink">Message</h2>
          <SegmentedControl
            size="md"
            value={view}
            onChange={setView}
            options={[
              { value: "write", label: "Write", icon: <Icon.Edit className="size-4" /> },
              { value: "preview", label: "Email preview", icon: <Icon.Eye className="size-4" /> },
            ]}
          />
        </div>

        {view === "write" ? (
          <div className="mt-5 space-y-5">
            <Field label="Subject" htmlFor={ids.subject} required error={errors.subject} hint={`${subject.length}/${CONTENT_LIMITS.subject} characters`}>
              <Input
                id={ids.subject}
                value={subject}
                onChange={(e) => change("subject", e.target.value)}
                onFocus={() => (lastField.current = "subject")}
                maxLength={CONTENT_LIMITS.subject}
                invalid={!!errors.subject}
                placeholder="What's new this month, {{ first_name }}"
                autoComplete="off"
                autoFocus={!broadcast}
              />
            </Field>
            <Field
              label="Preview text"
              htmlFor={ids.preheader}
              error={errors.preheader}
              hint="Shown after the subject in most inboxes. Leave empty to use the start of the message."
            >
              <Input
                id={ids.preheader}
                value={preheader}
                onChange={(e) => change("preheader", e.target.value)}
                onFocus={() => (lastField.current = "preheader")}
                maxLength={CONTENT_LIMITS.preheader}
                invalid={!!errors.preheader}
                autoComplete="off"
              />
            </Field>
            <div>
              <label htmlFor={ids.body} className="mb-1.5 block text-sm font-medium text-ink">
                Message<span className="ml-0.5 text-danger">*</span>
              </label>
              <div onFocusCapture={() => (lastField.current = "body")}>
                <MarkdownEditor
                  id={ids.body}
                  value={body}
                  onChange={(value) => change("body", value)}
                  rows={14}
                  invalid={!!errors.body}
                  placeholder={"Hi {{ first_name }},\n\nWrite your message in Markdown…"}
                />
              </div>
              {errors.body && <p className="mt-1.5 text-xs text-danger">{errors.body}</p>}
              <PlaceholderBar kind="broadcast" onInsert={insert} className="mt-2" />
              <p className="mt-1.5 text-xs text-ink-muted">
                Placeholders are filled in for every recipient. They go into the field you edited last — subject, preview text or message.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            {body.trim() ? (
              <LiveEmailPreview kind="broadcast" subject={subject} preheader={preheader} body={body} />
            ) : (
              <p className="rounded-lg border border-dashed border-border-strong px-4 py-10 text-center text-sm text-ink-muted">
                Write a message to see how the email will look.
              </p>
            )}
          </div>
        )}
      </Card>

      {segmentNotice && (
        <p role="status" className="flex gap-2 rounded-card border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{segmentNotice}</span>
        </p>
      )}

      <SegmentBuilder
        courses={courses}
        defaultValue={segment}
        onChange={(next) => {
          setSegment(next);
          setDirty(true);
        }}
      />

      <div className="space-y-3">
        {state && !state.ok && <FormError message={state.error} />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <ButtonLink href={broadcast ? `/admin/broadcasts/${broadcast.id}` : "/admin/broadcasts"} variant="outline">
            Cancel
          </ButtonLink>
          <Button type="submit" form={formId} loading={pending} rightIcon={<Icon.ArrowRight className="size-4 rtl:rotate-180" />}>
            {broadcast ? "Save and review" : "Save draft and review"}
          </Button>
        </div>
        <p className="text-right text-xs text-ink-muted">Nothing is sent yet. On the next page you can send yourself a test, then schedule the broadcast or send it right away.</p>
      </div>
    </div>
  );
}

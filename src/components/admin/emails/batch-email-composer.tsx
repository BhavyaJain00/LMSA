"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { sendBatchEmailAction } from "@/lib/actions/email-templates";
import { Markdown } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

export interface ComposerStudent {
  id: string;
  name: string;
  email: string;
}

export interface ComposerBatch {
  id: string;
  title: string;
  students: ComposerStudent[];
  templates: { id: string; name: string; subject: string; body: string }[];
  /** Placeholder values without the member-specific ones. */
  values: Record<string, string>;
}

const PLACEHOLDERS = [
  "member_name",
  "member_email",
  "batch_title",
  "batch_url",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "timezone",
  "medium",
  "instructors",
  "site_name",
];

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key: string) => values[key] ?? m);
}

type SendResult = ActionResult<{ queued: number; skipped: number; cc: number }>;

/** Compose an email to a batch's students from a template or from scratch, with a live preview. */
export function BatchEmailComposer({ batches, initialBatchId }: { batches: ComposerBatch[]; initialBatchId?: string }) {
  const toast = useToast();
  const [batchId, setBatchId] = useState(initialBatchId && batches.some((b) => b.id === initialBatchId) ? initialBatchId : (batches[0]?.id ?? ""));
  const batch = batches.find((b) => b.id === batchId) ?? null;
  const [mode, setMode] = useState<"template" | "custom">(batch?.templates.length ? "template" : "custom");
  const [templateId, setTemplateId] = useState(batch?.templates[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [cc, setCc] = useState("");

  const template = batch?.templates.find((t) => t.id === templateId) ?? null;
  const effectiveSubject = mode === "template" ? (template?.subject ?? "") : subject;
  const effectiveBody = mode === "template" ? (template?.body ?? "") : body;
  const recipients = batch ? (audience === "all" ? batch.students : batch.students.filter((s) => selected.has(s.id))) : [];
  const sample = recipients[0] ?? batch?.students[0] ?? null;
  const previewValues = useMemo(
    () => ({ ...(batch?.values ?? {}), member_name: sample?.name ?? "Alex Johnson", member_email: sample?.email ?? "alex@example.com" }),
    [batch, sample],
  );
  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (batch?.students ?? []).filter((s) => !q || `${s.name} ${s.email}`.toLowerCase().includes(q));
  }, [batch, search]);

  const [state, action, pending] = useActionState<SendResult | null, FormData>(async (prev, formData) => {
    const result = await sendBatchEmailAction(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Email sent");
      if (mode === "custom") {
        setSubject("");
        setBody("");
      }
      setCc("");
    } else {
      toast.error("Email not sent", result.error);
    }
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  if (!batches.length) {
    return (
      <EmptyState
        icon={<Icon.Users />}
        title="No batches yet"
        description="Batch emails go to the students of a batch. Create a batch and enroll students first."
        action={
          <Link href="/admin/batches" className="text-sm font-medium text-accent hover:underline">
            Go to batches
          </Link>
        }
      />
    );
  }

  const changeBatch = (id: string) => {
    setBatchId(id);
    const next = batches.find((b) => b.id === id);
    setTemplateId(next?.templates[0]?.id ?? "");
    setMode(next?.templates.length ? "template" : "custom");
    setSelected(new Set());
    setAudience("all");
    setSearch("");
  };

  const insertPlaceholder = (key: string) => {
    const token = `{{ ${key} }}`;
    const el = document.getElementById("compose-body") as HTMLTextAreaElement | null;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // CC addresses alone never make a send: at least one student must be a recipient.
  const canSend = !!batch && !!effectiveSubject.trim() && !!effectiveBody.trim() && recipients.length > 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form action={action} className="min-w-0 space-y-5" noValidate>
        <input type="hidden" name="batchId" value={batchId} />
        {mode === "template" && template && <input type="hidden" name="templateId" value={template.id} />}
        {/* Always explicit: an empty selection must never be read as "everyone". */}
        <input type="hidden" name="audience" value={audience} />
        {audience === "selected" && Array.from(selected).map((id) => <input key={id} type="hidden" name="userId" value={id} />)}
        <FormError message={state && !state.ok && !Object.keys(errors).length ? state.error : null} />
        {state?.ok && (
          <FormSuccess message={`${state.message ?? "Email sent"}. Delivery status is in the outbox.`} />
        )}

        <Card className="space-y-4 p-4 sm:p-5">
          <Field label="Batch" htmlFor="compose-batch" required>
            <Select id="compose-batch" value={batchId} onChange={(e) => changeBatch(e.target.value)} options={batches.map((b) => ({ value: b.id, label: `${b.title} (${b.students.length})` }))} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">Message</span>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={[
                { value: "template", label: "Use a template" },
                { value: "custom", label: "Write a message" },
              ]}
            />
          </div>
          {mode === "template" ? (
            batch?.templates.length ? (
              <Field label="Template" htmlFor="compose-template" required hint="Templates are managed on the batch's Emails tab.">
                <Select id="compose-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} options={batch.templates.map((t) => ({ value: t.id, label: t.name }))} />
              </Field>
            ) : (
              <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-sm text-ink-muted">
                This batch has no email templates yet.{" "}
                <Link href={`/admin/batches/${batchId}?tab=emails`} className="font-medium text-accent hover:underline">
                  Create one
                </Link>{" "}
                or write a message instead.
              </p>
            )
          ) : (
            <>
              <Field label="Subject" htmlFor="compose-subject" required error={errors.subject}>
                <Input id="compose-subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} invalid={!!errors.subject} placeholder="Welcome to {{ batch_title }}" />
              </Field>
              <Field label="Message" htmlFor="compose-body" required error={errors.body} hint="Markdown is supported. Placeholders are filled for each student.">
                <Textarea
                  id="compose-body"
                  name="body"
                  rows={10}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  invalid={!!errors.body}
                  className="font-mono text-[13px]"
                  placeholder={"Hi {{ member_name }},\n\nOur next session starts on {{ start_date }} at {{ start_time }} ({{ timezone }})."}
                />
              </Field>
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-muted">Placeholders — click to insert</p>
                <div className="flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => insertPlaceholder(key)}
                      className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted hover:border-accent hover:text-accent"
                    >
                      {`{{ ${key} }}`}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>

        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">Recipients</span>
            <SegmentedControl
              value={audience}
              onChange={setAudience}
              options={[
                { value: "all", label: `All students (${batch?.students.length ?? 0})` },
                { value: "selected", label: "Choose students" },
              ]}
            />
          </div>
          {audience === "selected" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input type="search" aria-label="Search students" placeholder="Search students" value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1" />
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(visibleStudents.map((s) => s.id)))} disabled={!visibleStudents.length}>
                  Select all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={!selected.size}>
                  Clear
                </Button>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                {visibleStudents.length === 0 ? (
                  <p className="text-sm text-ink-muted">{batch?.students.length ? "No students match your search." : "No students are enrolled in this batch yet."}</p>
                ) : (
                  visibleStudents.map((s) => (
                    <Checkbox key={s.id} id={`student-${s.id}`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} label={s.name} description={s.email} />
                  ))
                )}
              </div>
              <p className={selected.size ? "text-xs text-ink-muted" : "text-xs text-warning"}>{selected.size ? `${selected.size} selected` : "Select at least one student to send this email."}</p>
            </div>
          )}
          {errors.recipients && <p className="text-xs text-danger">{errors.recipients}</p>}
          <Field label="CC" htmlFor="compose-cc" error={errors.cc} hint="Optional. Comma-separated addresses receive one copy of the message, sent along with the students' emails.">
            <Input id="compose-cc" name="cc" value={cc} onChange={(e) => setCc(e.target.value)} invalid={!!errors.cc} placeholder="mentor@example.com, coordinator@example.com" />
          </Field>
          <p className="text-xs text-ink-muted">Students who turned off announcement emails are skipped automatically. Every email includes an unsubscribe link.</p>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="submit" loading={pending} disabled={!canSend} leftIcon={<Icon.Send className="size-4" />}>
            {audience === "all"
              ? `Send to ${batch?.students.length ?? 0} ${batch?.students.length === 1 ? "student" : "students"}`
              : selected.size
                ? `Send to ${selected.size} selected`
                : "Select students to send"}
          </Button>
        </div>
      </form>

      <div className="min-w-0">
        <div className="xl:sticky xl:top-20">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Preview{sample ? ` for ${sample.name}` : " with sample values"}</p>
          <Card className="p-4 sm:p-5">
            {effectiveSubject || effectiveBody ? (
              <>
                <p className="border-b border-border pb-3 text-sm">
                  <span className="text-ink-muted">Subject: </span>
                  <span className="font-medium text-ink">{fill(effectiveSubject, previewValues) || "—"}</span>
                </p>
                <div className="pt-3">
                  <Markdown content={fill(effectiveBody, previewValues)} className="text-sm" />
                </div>
              </>
            ) : (
              <p className="py-10 text-center text-sm text-ink-muted">Your message preview appears here.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

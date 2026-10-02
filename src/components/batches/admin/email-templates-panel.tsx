"use client";

import { useState } from "react";
import { Markdown } from "@/lib/markdown";
import { deleteEmailTemplateAction, saveEmailTemplateAction, sendBatchEmailAction } from "@/lib/actions/email-templates";
import { formatDate } from "@/lib/utils";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useActionForm, useServerAction } from "../hooks";
import type { EmailTemplateView } from "../types";

export const EMAIL_PLACEHOLDERS: { key: string; description: string }[] = [
  { key: "member_name", description: "Learner's full name" },
  { key: "member_email", description: "Learner's email" },
  { key: "batch_title", description: "Batch title" },
  { key: "batch_url", description: "Link to the batch page" },
  { key: "start_date", description: "First day" },
  { key: "end_date", description: "Last day" },
  { key: "start_time", description: "Session start time" },
  { key: "end_time", description: "Session end time" },
  { key: "timezone", description: "Batch timezone" },
  { key: "medium", description: "Online / Offline" },
  { key: "instructors", description: "Instructor names" },
  { key: "site_name", description: "Platform name" },
];

export function fillPlaceholders(text: string, sample: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key: string) => sample[key] ?? m);
}

function TemplateForm({ batchId, template, sample, onDone }: { batchId: string; template: EmailTemplateView | null; sample: Record<string, string>; onDone: () => void }) {
  const [subject, setSubject] = useState(template?.subject ?? "Your enrollment in {{ batch_title }} is confirmed");
  const [body, setBody] = useState(
    template?.body ??
      "Dear {{ member_name }},\n\nYou have been enrolled in our upcoming batch **{{ batch_title }}**. It starts on {{ start_date }} at {{ start_time }} ({{ timezone }}).\n\nSee you there!\n{{ instructors }}",
  );
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const { onSubmit, pending, error, fieldErrors } = useActionForm(saveEmailTemplateAction, { onSuccess: onDone });

  const insert = (key: string) => {
    const token = `{{ ${key} }}`;
    const el = document.getElementById("tpl-body") as HTMLTextAreaElement | null;
    if (!el || mode !== "edit") {
      setBody((b) => `${b}${token}`);
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

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="batchId" value={batchId} />
      {template && <input type="hidden" name="templateId" value={template.id} />}
      <FormError message={error} />
      <Field label="Name" htmlFor="tpl-name" required error={fieldErrors.name}>
        <Input id="tpl-name" name="name" defaultValue={template?.name} placeholder="Batch Enrollment Confirmation" required maxLength={80} invalid={!!fieldErrors.name} autoFocus />
      </Field>
      <Field label="Subject" htmlFor="tpl-subject" required error={fieldErrors.subject}>
        <Input id="tpl-subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} invalid={!!fieldErrors.subject} />
      </Field>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor="tpl-body" className="text-sm font-medium text-ink">
            Content <span className="text-danger">*</span>
          </label>
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              { value: "edit", label: "Edit" },
              { value: "preview", label: "Preview" },
            ]}
          />
        </div>
        <Textarea
          id="tpl-body"
          name="body"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          invalid={!!fieldErrors.body}
          className={mode === "preview" ? "hidden" : "font-mono text-[13px]"}
        />
        {mode === "preview" && (
          <div className="rounded-lg border border-border bg-surface-2/50 p-4">
            <p className="mb-3 border-b border-border pb-2 text-sm">
              <span className="text-ink-muted">Subject: </span>
              <span className="font-medium text-ink">{fillPlaceholders(subject, sample)}</span>
            </p>
            <Markdown content={fillPlaceholders(body, sample)} className="text-sm" />
            <p className="mt-3 text-xs text-ink-faint">Preview uses sample values.</p>
          </div>
        )}
        {fieldErrors.body && <p className="mt-1.5 text-xs text-danger">{fieldErrors.body}</p>}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-ink-muted">Placeholders — click to insert</p>
        <div className="flex flex-wrap gap-1.5">
          {EMAIL_PLACEHOLDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              title={p.description}
              onClick={() => insert(p.key)}
              className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted hover:border-accent hover:text-accent"
            >
              {`{{ ${p.key} }}`}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Send one template to every student of the batch (placeholders filled per student). */
function SendTemplateForm({
  batchId,
  template,
  sample,
  studentCount,
  composeHref,
  onDone,
}: {
  batchId: string;
  template: EmailTemplateView;
  sample: Record<string, string>;
  studentCount: number;
  composeHref: string | null;
  onDone: () => void;
}) {
  const { onSubmit, pending, error, fieldErrors } = useActionForm(sendBatchEmailAction, { onSuccess: onDone });
  const noStudents = studentCount === 0;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="templateId" value={template.id} />
      <input type="hidden" name="audience" value="all" />
      <FormError message={error} />
      <div className="rounded-lg border border-border bg-surface-2/50 p-4">
        <p className="mb-3 border-b border-border pb-2 text-sm">
          <span className="text-ink-muted">Subject: </span>
          <span className="font-medium text-ink">{fillPlaceholders(template.subject, sample)}</span>
        </p>
        <Markdown content={fillPlaceholders(template.body, sample)} className="text-sm" />
        <p className="mt-3 text-xs text-ink-faint">Preview uses sample values; each student gets their own name and details.</p>
      </div>
      <p className="flex items-start gap-2 text-sm text-ink-muted">
        <Icon.Users className="mt-0.5 size-4 shrink-0 text-ink-faint" />
        {noStudents
          ? "No students are enrolled in this batch yet, so there is nobody to email."
          : `Sends to all ${studentCount} enrolled ${studentCount === 1 ? "student" : "students"}. Students who turned off batch emails are skipped.`}
      </p>
      <Field label="CC" htmlFor="send-cc" hint="Optional. Separate several addresses with commas." error={fieldErrors.cc}>
        <Input id="send-cc" name="cc" type="text" inputMode="email" autoComplete="off" placeholder="mentor@example.com" invalid={!!fieldErrors.cc} disabled={noStudents} />
      </Field>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        {composeHref ? (
          <ButtonLink href={composeHref} variant="ghost" size="sm" leftIcon={<Icon.Edit className="size-4" />}>
            Pick recipients or edit first
          </ButtonLink>
        ) : (
          <span />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={noStudents} leftIcon={<Icon.Send className="size-4" />}>
            Send email
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Batch email templates (e.g. enrollment confirmation) with placeholders, preview and sending. */
export function EmailTemplatesPanel({
  batchId,
  templates,
  sample,
  studentCount,
  canCompose = false,
}: {
  batchId: string;
  templates: EmailTemplateView[];
  sample: Record<string, string>;
  /** Enrolled students (the recipients of "Send"). */
  studentCount: number;
  /** Moderators can open the full composer (/admin/emails/compose) to pick recipients. */
  canCompose?: boolean;
}) {
  const [editing, setEditing] = useState<EmailTemplateView | null | "new">(null);
  const [previewing, setPreviewing] = useState<EmailTemplateView | null>(null);
  const [deleting, setDeleting] = useState<EmailTemplateView | null>(null);
  const [sending, setSending] = useState<EmailTemplateView | null>(null);
  const { pending, run } = useServerAction();
  const open = editing !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Email templates</h2>
          <p className="text-sm text-ink-muted">Reusable messages for this batch, such as the enrollment confirmation. Placeholders are filled per learner.</p>
        </div>
        <Button onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />}>
          New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={<Icon.Mail />}
          title="No email templates yet"
          description="Create an enrollment confirmation or reminder template for this batch."
          action={
            <Button onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />}>
              New template
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink">{t.name}</h3>
                  <p className="truncate text-sm text-ink-muted">{t.subject}</p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <IconButton label={`Send ${t.name}`} size="icon-sm" onClick={() => setSending(t)}>
                    <Icon.Send className="size-4" />
                  </IconButton>
                  <IconButton label={`Preview ${t.name}`} size="icon-sm" onClick={() => setPreviewing(t)}>
                    <Icon.Eye className="size-4" />
                  </IconButton>
                  <IconButton label={`Edit ${t.name}`} size="icon-sm" onClick={() => setEditing(t)}>
                    <Icon.Edit className="size-4" />
                  </IconButton>
                  <IconButton label={`Delete ${t.name}`} size="icon-sm" onClick={() => setDeleting(t)} className="hover:text-danger">
                    <Icon.Trash className="size-4" />
                  </IconButton>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 whitespace-pre-line font-mono text-xs text-ink-muted">{t.body}</p>
              <p className="mt-auto pt-3 text-xs text-ink-faint">Updated {formatDate(t.updatedAt)}</p>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setEditing(null)} title={editing === "new" ? "New Email Template" : "Edit Email Template"} size="lg">
        {open && <TemplateForm batchId={batchId} template={editing === "new" ? null : editing} sample={sample} onDone={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={!!sending} onClose={() => setSending(null)} title={sending ? `Send "${sending.name}"` : "Send email"} description="Email this template to the batch's students." size="lg">
        {sending && (
          <SendTemplateForm
            batchId={batchId}
            template={sending}
            sample={sample}
            studentCount={studentCount}
            composeHref={canCompose ? `/admin/emails/compose?batch=${encodeURIComponent(batchId)}` : null}
            onDone={() => setSending(null)}
          />
        )}
      </Dialog>
      <Dialog open={!!previewing} onClose={() => setPreviewing(null)} title={previewing?.name} description="Preview with sample values" size="lg">
        {previewing && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="text-ink-muted">Subject: </span>
              <span className="font-medium text-ink">{fillPlaceholders(previewing.subject, sample)}</span>
            </p>
            <div className="rounded-lg border border-border bg-surface-2/50 p-4">
              <Markdown content={fillPlaceholders(previewing.body, sample)} className="text-sm" />
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) run(() => deleteEmailTemplateAction(deleting.id), { onSuccess: () => setDeleting(null) });
        }}
        loading={pending}
        destructive
        title={`Delete "${deleting?.name ?? "template"}"?`}
        description="This template will be removed permanently."
        confirmLabel="Delete"
      />
    </div>
  );
}

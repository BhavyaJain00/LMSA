"use client";

import { useState } from "react";
import { messageApplicantAction } from "@/lib/actions/jobs";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Dialog } from "@/components/ui/dialog";
import { useFormAction } from "@/components/admin/settings/use-form-action";

/**
 * "Send Email" on the applications list (Frappe: JobApplications). Delivers
 * the message as an in-app notification; "Open in email app" hands the same
 * subject and body to the viewer's mail client instead.
 */
export function MessageApplicantButton({
  applicationId,
  applicantName,
  applicantEmail,
  jobTitle,
  defaultReplyTo,
}: {
  applicationId: string;
  applicantName: string;
  applicantEmail: string;
  jobTitle: string;
  defaultReplyTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const defaultSubject = `Job Application for ${jobTitle} - ${applicantName}`;
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState(defaultReplyTo ?? "");
  const { onSubmit, pending, errors } = useFormAction(messageApplicantAction, {
    onSuccess: () => {
      setOpen(false);
      setMessage("");
      setSubject(defaultSubject);
    },
  });
  const formId = `message-${applicationId}`;
  const mailto = `mailto:${applicantEmail}?subject=${encodeURIComponent(subject)}${replyTo ? `&cc=${encodeURIComponent(replyTo)}` : ""}${message ? `&body=${encodeURIComponent(message)}` : ""}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        <Icon.Mail className="size-3.5" />
        <span className="hidden sm:inline">Send Email</span>
        <span className="sr-only sm:hidden">Send Email to {applicantName}</span>
      </button>
      <Dialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        size="lg"
        title={`Send Email to ${applicantName}`}
        description={`${applicantEmail} · The message appears in their notifications.`}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <a href={mailto} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              <Icon.ExternalLink className="size-4" />
              Open in email app
            </a>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" form={formId} loading={pending} leftIcon={<Icon.Send className="size-4" />}>
                Send
              </Button>
            </div>
          </div>
        }
      >
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
          <input type="hidden" name="applicationId" value={applicationId} />
          <Field label="Subject" htmlFor={`${formId}-subject`} error={errors.subject} required>
            <Input
              id={`${formId}-subject`}
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter email subject"
              maxLength={150}
              invalid={!!errors.subject}
            />
          </Field>
          <Field label="Reply To" htmlFor={`${formId}-reply`} error={errors.replyTo} hint={errors.replyTo ? undefined : "Where the applicant can answer you by email."}>
            <Input
              id={`${formId}-reply`}
              name="replyTo"
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="Enter reply to email"
              invalid={!!errors.replyTo}
            />
          </Field>
          <Field label="Message" htmlFor={`${formId}-message`} error={errors.message} hint={errors.message ? undefined : `${message.length}/5000`} required>
            <Textarea
              id={`${formId}-message`}
              name="message"
              rows={7}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              placeholder={`Hi ${applicantName.split(" ")[0] ?? applicantName}, thanks for applying…`}
              invalid={!!errors.message}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

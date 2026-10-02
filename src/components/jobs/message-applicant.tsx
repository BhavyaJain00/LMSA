"use client";

import { useState } from "react";
import { messageApplicantAction } from "@/lib/actions/jobs";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Dialog } from "@/components/ui/dialog";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { useT } from "@/i18n/client";

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
  const t = useT("public");
  const common = useT("common");
  const [open, setOpen] = useState(false);
  const defaultSubject = t("jobs.message.defaultSubject", { title: jobTitle, name: applicantName });
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
        <span className="hidden sm:inline">{t("jobs.message.button")}</span>
        <span className="sr-only sm:hidden">{t("jobs.message.title", { name: applicantName })}</span>
      </button>
      <Dialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        size="lg"
        title={t("jobs.message.title", { name: applicantName })}
        description={t("jobs.message.description", { email: applicantEmail })}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <a href={mailto} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              <Icon.ExternalLink className="size-4" />
              {t("jobs.message.openApp")}
            </a>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {common("actions.cancel")}
              </Button>
              <Button type="submit" form={formId} loading={pending} leftIcon={<Icon.Send className="size-4" />}>
                {t("jobs.message.send")}
              </Button>
            </div>
          </div>
        }
      >
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
          <input type="hidden" name="applicationId" value={applicationId} />
          <Field label={t("jobs.message.subject")} htmlFor={`${formId}-subject`} error={errors.subject} required>
            <Input
              id={`${formId}-subject`}
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("jobs.message.subjectPlaceholder")}
              maxLength={150}
              invalid={!!errors.subject}
            />
          </Field>
          <Field label={t("jobs.message.replyTo")} htmlFor={`${formId}-reply`} error={errors.replyTo} hint={errors.replyTo ? undefined : t("jobs.message.replyToHint")}>
            <Input
              id={`${formId}-reply`}
              name="replyTo"
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder={t("jobs.message.replyToPlaceholder")}
              dir="ltr"
              invalid={!!errors.replyTo}
            />
          </Field>
          <Field label={t("jobs.message.message")} htmlFor={`${formId}-message`} error={errors.message} hint={errors.message ? undefined : t("jobs.apply.charCount", { length: message.length, max: 5000 })} required>
            <Textarea
              id={`${formId}-message`}
              name="message"
              rows={7}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              placeholder={t("jobs.message.placeholder", { name: applicantName.split(" ")[0] ?? applicantName })}
              invalid={!!errors.message}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

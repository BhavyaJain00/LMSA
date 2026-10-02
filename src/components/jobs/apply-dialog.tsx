"use client";

import { useState } from "react";
import { applyToJobAction } from "@/lib/actions/jobs";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Dialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { useT } from "@/i18n/client";

/** "Apply" button + dialog: PDF resume (required) and an optional cover letter. */
export function ApplyDialog({ jobId, jobTitle, company }: { jobId: string; jobTitle: string; company: string }) {
  const t = useT("public");
  const common = useT("common");
  const [open, setOpen] = useState(false);
  const [resumeUrl, setResumeUrl] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const { onSubmit, pending, errors } = useFormAction(applyToJobAction, {
    onSuccess: () => {
      setOpen(false);
      setResumeUrl("");
      setCoverLetter("");
    },
  });
  const resumeError = localError ?? errors.resumeUrl;

  return (
    <>
      <Button onClick={() => setOpen(true)} leftIcon={<Icon.Send className="size-4" />}>
        {t("jobs.apply.button")}
      </Button>
      <Dialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        size="lg"
        title={t("jobs.apply.title")}
        description={t("jobs.apply.subtitle", { title: jobTitle, company })}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {common("actions.cancel")}
            </Button>
            <Button type="submit" form={`apply-${jobId}`} loading={pending}>
              {common("actions.submit")}
            </Button>
          </>
        }
      >
        <form
          id={`apply-${jobId}`}
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            if (!resumeUrl) {
              e.preventDefault();
              setLocalError(t("jobs.apply.resumeRequired"));
              return;
            }
            setLocalError(null);
            onSubmit(e);
          }}
        >
          <input type="hidden" name="jobId" value={jobId} />
          <p className="text-sm text-ink-muted">
            {t("jobs.apply.intro")}
          </p>
          <div>
            <FileUpload
              label={t("jobs.apply.resume")}
              name="resumeUrl"
              kind="document"
              accept="application/pdf,.pdf"
              value={resumeUrl}
              onChange={(url, meta) => {
                if (url && meta && !/pdf$/i.test(meta.type) && !/\.pdf$/i.test(meta.name)) {
                  setLocalError(t("jobs.apply.pdfOnly"));
                  setResumeUrl("");
                  return;
                }
                setLocalError(null);
                setResumeUrl(url);
              }}
              hint={t("jobs.apply.resumeHint")}
            />
            {resumeError && (
              <p className="mt-1 text-xs text-danger" role="alert">
                {resumeError}
              </p>
            )}
          </div>
          <Field label={t("jobs.apply.coverLetter")} htmlFor={`cover-${jobId}`} error={errors.coverLetter} hint={errors.coverLetter ? undefined : t("jobs.apply.coverLetterHint", { length: coverLetter.length, max: 5000 })}>
            <Textarea
              id={`cover-${jobId}`}
              name="coverLetter"
              rows={6}
              maxLength={5000}
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
              placeholder={t("jobs.apply.coverLetterPlaceholder")}
              invalid={!!errors.coverLetter}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

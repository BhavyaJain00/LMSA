"use client";

import { useState } from "react";
import { applyToJobAction } from "@/lib/actions/jobs";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { Dialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { useFormAction } from "@/components/admin/settings/use-form-action";

/** "Apply" button + dialog: PDF resume (required) and an optional cover letter. */
export function ApplyDialog({ jobId, jobTitle, company }: { jobId: string; jobTitle: string; company: string }) {
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
        Apply
      </Button>
      <Dialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        size="lg"
        title="Apply for this job"
        description={`${jobTitle} · ${company}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={`apply-${jobId}`} loading={pending}>
              Submit
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
              setLocalError("Please upload your resume");
              return;
            }
            setLocalError(null);
            onSubmit(e);
          }}
        >
          <input type="hidden" name="jobId" value={jobId} />
          <p className="text-sm text-ink-muted">
            Submit your resume to proceed with your application for this position. Upon submission, it will be shared with the job poster.
          </p>
          <div>
            <FileUpload
              label="Resume (PDF)"
              name="resumeUrl"
              kind="document"
              accept="application/pdf,.pdf"
              value={resumeUrl}
              onChange={(url, meta) => {
                if (url && meta && !/pdf$/i.test(meta.type) && !/\.pdf$/i.test(meta.name)) {
                  setLocalError("Only PDF file is allowed");
                  setResumeUrl("");
                  return;
                }
                setLocalError(null);
                setResumeUrl(url);
              }}
              hint="Upload your resume as a PDF (max 25 MB)."
            />
            {resumeError && (
              <p className="mt-1 text-xs text-danger" role="alert">
                {resumeError}
              </p>
            )}
          </div>
          <Field label="Cover letter" htmlFor={`cover-${jobId}`} error={errors.coverLetter} hint={errors.coverLetter ? undefined : `Optional · ${coverLetter.length}/5000`}>
            <Textarea
              id={`cover-${jobId}`}
              name="coverLetter"
              rows={6}
              maxLength={5000}
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
              placeholder="Tell the team why you're a great fit for this role."
              invalid={!!errors.coverLetter}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

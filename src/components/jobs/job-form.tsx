"use client";

import { useEffect, useRef, useState } from "react";
import type { JobOpening } from "@/lib/types";
import { saveJobAction } from "@/lib/actions/jobs";
import { jobTypes } from "@/lib/config";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileUpload } from "@/components/ui/file-upload";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { MarkdownField } from "@/components/admin/settings/markdown-field";

export type JobFormValues = Pick<
  JobOpening,
  "id" | "slug" | "title" | "company" | "companyLogoUrl" | "companyWebsite" | "location" | "remote" | "type" | "description" | "salaryRange" | "status"
>;

/**
 * Create / edit a job opening (Frappe: JobForm). Sections: Job Details,
 * Location, Company Details. Ctrl/Cmd+S saves.
 */
export function JobForm({ job, cancelHref }: { job: JobFormValues | null; cancelHref: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [logoUrl, setLogoUrl] = useState(job?.companyLogoUrl ?? "");
  const { onSubmit, pending, errors, formError, dirty, markDirty } = useFormAction(saveJobAction, { toastSuccess: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <form ref={formRef} onSubmit={onSubmit} onChange={markDirty} noValidate className="pb-10">
      {job && <input type="hidden" name="id" value={job.id} />}
      <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
        {dirty && (
          <Badge tone="warning" dot className="mr-auto">
            Not Saved
          </Badge>
        )}
        {formError && !Object.keys(errors).length && <p className="mr-auto text-sm text-danger">{formError}</p>}
        <ButtonLink href={cancelHref} variant="outline">
          Cancel
        </ButtonLink>
        <Button type="submit" loading={pending} title="Save (Ctrl/⌘ + S)">
          {job ? "Save" : "Publish job"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <section className="space-y-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
          <h2 className="text-base font-semibold text-ink">Job Details</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Title" htmlFor="job-title" error={errors.title} required className="sm:col-span-3">
              <Input id="job-title" name="title" defaultValue={job?.title} placeholder="Junior Frontend Developer" maxLength={120} invalid={!!errors.title} autoFocus={!job} />
            </Field>
            <Field label="Type" htmlFor="job-type" error={errors.type} required>
              <Select id="job-type" name="type" defaultValue={job?.type ?? "full_time"} options={jobTypes.map((t) => ({ value: t.value, label: t.label }))} />
            </Field>
            <Field label="Salary range" htmlFor="job-salary" error={errors.salaryRange} className="sm:col-span-2">
              <Input id="job-salary" name="salaryRange" defaultValue={job?.salaryRange} placeholder="$80k – $100k" maxLength={60} invalid={!!errors.salaryRange} />
            </Field>
          </div>
          <Field label="Description" htmlFor="job-description" error={errors.description} hint={errors.description ? undefined : "Markdown supported: responsibilities, requirements, benefits, how to apply."} required>
            <MarkdownField
              id="job-description"
              name="description"
              defaultValue={job?.description}
              rows={16}
              placeholder={"## About the role\n\nWhat the person will do...\n\n## Requirements\n\n- ..."}
              invalid={!!errors.description}
              onChange={markDirty}
            />
          </Field>
        </section>

        <div className="space-y-6">
          {job && (
            <section className="space-y-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
              <Field label="Status" htmlFor="job-status" error={errors.status} hint="Closed jobs stop accepting applications and leave the public board." required>
                <Select
                  id="job-status"
                  name="status"
                  defaultValue={job.status}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "closed", label: "Closed" },
                  ]}
                />
              </Field>
            </section>
          )}
          <section className="space-y-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
            <h2 className="text-base font-semibold text-ink">Location</h2>
            <Field label="City" htmlFor="job-location" error={errors.location} required>
              <Input id="job-location" name="location" defaultValue={job?.location} placeholder="Berlin, Germany" maxLength={120} invalid={!!errors.location} />
            </Field>
            <Switch id="job-remote" name="remote" defaultChecked={job?.remote ?? false} label="Remote" description="Candidates can work from anywhere." />
          </section>
          <section className="space-y-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
            <h2 className="text-base font-semibold text-ink">Company Details</h2>
            <Field label="Company Name" htmlFor="job-company" error={errors.company} required>
              <Input id="job-company" name="company" defaultValue={job?.company} placeholder="Acme Inc." maxLength={100} invalid={!!errors.company} />
            </Field>
            <Field label="Company Website" htmlFor="job-website" error={errors.companyWebsite}>
              <Input id="job-website" name="companyWebsite" type="url" defaultValue={job?.companyWebsite} placeholder="https://acme.com" invalid={!!errors.companyWebsite} />
            </Field>
            <div>
              <FileUpload
                label="Company Logo"
                name="companyLogoUrl"
                kind="image"
                value={logoUrl}
                onChange={(url) => {
                  setLogoUrl(url);
                  markDirty();
                }}
                hint="Square PNG or SVG works best."
              />
              {errors.companyLogoUrl && <p className="mt-1 text-xs text-danger">{errors.companyLogoUrl}</p>}
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}

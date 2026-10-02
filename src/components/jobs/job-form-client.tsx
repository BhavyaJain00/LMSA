"use client";

import { useEffect, useRef, useState } from "react";
import { saveJobAction } from "@/lib/actions/jobs";
import { jobTypes } from "@/lib/config";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileUpload } from "@/components/ui/file-upload";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { MarkdownField } from "@/components/admin/settings/markdown-field";
import { UnsavedChangesGuard } from "@/components/admin/settings/unsaved-changes-guard";
import { COUNTRIES } from "@/components/commerce/countries";
import type { JobFormValues } from "./job-form-values";
import { WORK_MODES, resolveWorkMode } from "./work-mode";
import { useT } from "@/i18n/client";

/* Rendered through `./job-form.tsx`, which provides the `jobs.` messages on the admin pages too. */

export type { JobFormValues };

/**
 * Create / edit a job opening (Frappe: JobForm). Sections: Job Details,
 * Location, Company Details. Ctrl/Cmd+S saves.
 */
export function JobForm({ job, cancelHref }: { job: JobFormValues | null; cancelHref: string }) {
  const t = useT("public");
  const common = useT("common");
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

  return (
    <form ref={formRef} onSubmit={onSubmit} onChange={markDirty} noValidate className="pb-10">
      {job && <input type="hidden" name="id" value={job.id} />}
      <UnsavedChangesGuard when={dirty && !pending} />
      <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
        {dirty && (
          <Badge tone="warning" dot className="me-auto">
            {t("jobs.form.notSaved")}
          </Badge>
        )}
        {formError && !Object.keys(errors).length && <p className="me-auto text-sm text-danger">{formError}</p>}
        <ButtonLink href={cancelHref} variant="outline">
          {common("actions.cancel")}
        </ButtonLink>
        <Button type="submit" loading={pending} title={t("jobs.form.saveShortcut")}>
          {job ? common("actions.save") : t("jobs.form.publish")}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <section className="space-y-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
          <h2 className="text-base font-semibold text-ink">{t("jobs.form.details")}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("jobs.form.title")} htmlFor="job-title" error={errors.title} required className="sm:col-span-3">
              <Input id="job-title" name="title" defaultValue={job?.title} placeholder={t("jobs.form.titlePlaceholder")} maxLength={120} invalid={!!errors.title} autoFocus={!job} />
            </Field>
            <Field label={t("jobs.form.type")} htmlFor="job-type" error={errors.type} required>
              <Select id="job-type" name="type" defaultValue={job?.type ?? "full_time"} options={jobTypes.map((type) => ({ value: type.value, label: t(`jobs.type.${type.value}`) }))} />
            </Field>
            <Field label={t("jobs.form.workMode")} htmlFor="job-work-mode" error={errors.workMode} required>
              <Select
                id="job-work-mode"
                name="workMode"
                defaultValue={job ? resolveWorkMode(job) : "onsite"}
                options={WORK_MODES.map((m) => ({ value: m.value, label: t(`jobs.mode.${m.value}`) }))}
              />
            </Field>
            <Field label={t("jobs.form.salary")} htmlFor="job-salary" error={errors.salaryRange}>
              <Input id="job-salary" name="salaryRange" defaultValue={job?.salaryRange} placeholder={t("jobs.form.salaryPlaceholder")} maxLength={60} invalid={!!errors.salaryRange} />
            </Field>
          </div>
          <Field label={t("jobs.form.description")} htmlFor="job-description" error={errors.description} hint={errors.description ? undefined : t("jobs.form.descriptionHint")} required>
            <MarkdownField
              id="job-description"
              name="description"
              defaultValue={job?.description}
              rows={16}
              placeholder={t("jobs.form.descriptionPlaceholder")}
              invalid={!!errors.description}
              onChange={markDirty}
            />
          </Field>
        </section>

        <div className="space-y-6">
          {job && (
            <section className="space-y-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
              <Field label={t("jobs.form.status")} htmlFor="job-status" error={errors.status} hint={t("jobs.form.statusHint")} required>
                <Select
                  id="job-status"
                  name="status"
                  defaultValue={job.status}
                  options={[
                    { value: "open", label: t("jobs.status.open") },
                    { value: "closed", label: t("jobs.status.closed") },
                  ]}
                />
              </Field>
            </section>
          )}
          <section className="space-y-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
            <h2 className="text-base font-semibold text-ink">{t("jobs.form.location")}</h2>
            <Field label={t("jobs.form.city")} htmlFor="job-location" error={errors.location} required>
              <Input id="job-location" name="location" defaultValue={job?.location} placeholder={t("jobs.form.cityPlaceholder")} maxLength={120} invalid={!!errors.location} />
            </Field>
            <Field label={t("jobs.form.country")} htmlFor="job-country" error={errors.country} hint={t("jobs.form.countryHint")}>
              <Select id="job-country" name="country" defaultValue={job?.country ?? ""} invalid={!!errors.country}>
                <option value="">{t("jobs.form.selectCountry")}</option>
                {job?.country && !(COUNTRIES as readonly string[]).includes(job.country) && <option value={job.country}>{job.country}</option>}
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </section>
          <section className="space-y-4 rounded-card border border-border bg-surface-1 p-5 shadow-card">
            <h2 className="text-base font-semibold text-ink">{t("jobs.form.company")}</h2>
            <Field label={t("jobs.form.companyName")} htmlFor="job-company" error={errors.company} required>
              <Input id="job-company" name="company" defaultValue={job?.company} placeholder={t("jobs.form.companyPlaceholder")} maxLength={100} invalid={!!errors.company} />
            </Field>
            <Field label={t("jobs.form.website")} htmlFor="job-website" error={errors.companyWebsite}>
              <Input id="job-website" name="companyWebsite" type="url" dir="ltr" defaultValue={job?.companyWebsite} placeholder="https://acme.com" invalid={!!errors.companyWebsite} />
            </Field>
            <div>
              <FileUpload
                label={t("jobs.form.logo")}
                name="companyLogoUrl"
                kind="image"
                value={logoUrl}
                onChange={(url) => {
                  setLogoUrl(url);
                  markDirty();
                }}
                hint={t("jobs.form.logoHint")}
              />
              {errors.companyLogoUrl && <p className="mt-1 text-xs text-danger">{errors.companyLogoUrl}</p>}
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}

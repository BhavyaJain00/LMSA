"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Batch } from "@/lib/types";
import { createBatchAction, updateBatchAction } from "@/lib/actions/batches";
import { currencies } from "@/lib/config";
import { cn, slugify } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileUpload } from "@/components/ui/file-upload";
import { Field, FormError, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useActionForm } from "../hooks";
import type { Option } from "../types";
import { MarkdownField, PeoplePicker, TimezoneSelect } from "./form-fields";

interface CoreValues {
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  categoryId: string;
  seatCount: string;
  medium: "online" | "offline";
  description: string;
  details: string;
  instructorIds: string[];
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-6 last:border-b-0 sm:px-6">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Title, dates, session times, timezone, category, seats and medium. */
function CoreFields({
  values,
  set,
  errors,
  categories,
}: {
  values: CoreValues;
  set: <K extends keyof CoreValues>(key: K, value: CoreValues[K]) => void;
  errors: Record<string, string>;
  categories: Option[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Title" htmlFor="title" required error={errors.title} className="sm:col-span-2 lg:col-span-3">
        <Input id="title" name="title" value={values.title} onChange={(e) => set("title", e.target.value)} required maxLength={140} invalid={!!errors.title} placeholder="e.g. JavaScript Bootcamp — Cohort 5" />
      </Field>
      <Field label="Batch Start Date" htmlFor="startDate" required error={errors.startDate}>
        <Input id="startDate" name="startDate" type="date" value={values.startDate} onChange={(e) => set("startDate", e.target.value)} required invalid={!!errors.startDate} />
      </Field>
      <Field label="Batch End Date" htmlFor="endDate" required error={errors.endDate}>
        <Input id="endDate" name="endDate" type="date" value={values.endDate} min={values.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} required invalid={!!errors.endDate} />
      </Field>
      <Field label="Timezone" htmlFor="timezone" required error={errors.timezone}>
        <TimezoneSelect id="timezone" name="timezone" value={values.timezone} onChange={(v) => set("timezone", v)} invalid={!!errors.timezone} />
      </Field>
      <Field label="Session Start Time" htmlFor="startTime" required error={errors.startTime}>
        <Input id="startTime" name="startTime" type="time" value={values.startTime} onChange={(e) => set("startTime", e.target.value)} required invalid={!!errors.startTime} />
      </Field>
      <Field label="Session End Time" htmlFor="endTime" required error={errors.endTime}>
        <Input id="endTime" name="endTime" type="time" value={values.endTime} onChange={(e) => set("endTime", e.target.value)} required invalid={!!errors.endTime} />
      </Field>
      <Field label="Medium" htmlFor="medium">
        <Select id="medium" name="medium" value={values.medium} onChange={(e) => set("medium", e.target.value === "offline" ? "offline" : "online")}>
          <option value="online">Online</option>
          <option value="offline">Offline (in person)</option>
        </Select>
      </Field>
      <Field label="Category" htmlFor="categoryId" error={errors.categoryId}>
        <Select id="categoryId" name="categoryId" value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)} invalid={!!errors.categoryId}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Seat Count" htmlFor="seatCount" error={errors.seatCount} hint="Leave 0 for unlimited seats.">
        <Input id="seatCount" name="seatCount" type="number" min={0} step={1} inputMode="numeric" value={values.seatCount} onChange={(e) => set("seatCount", e.target.value)} placeholder="Number of seats available" invalid={!!errors.seatCount} />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New batch                                                           */
/* ------------------------------------------------------------------ */

export function NewBatchForm({ categories, instructors, defaultInstructorId }: { categories: Option[]; instructors: Option[]; defaultInstructorId?: string }) {
  const [values, setValues] = useState<CoreValues>({
    title: "",
    startDate: "",
    endDate: "",
    startTime: "18:00",
    endTime: "19:30",
    timezone: "",
    categoryId: "",
    seatCount: "0",
    medium: "online",
    description: "",
    details: "",
    instructorIds: defaultInstructorId ? [defaultInstructorId] : [],
  });
  const set = <K extends keyof CoreValues>(key: K, value: CoreValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const { onSubmit, pending, error, fieldErrors } = useActionForm(createBatchAction);
  const formRef = useRef<HTMLFormElement>(null);

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
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <Card>
        {error && (
          <div className="px-5 pt-5 sm:px-6">
            <FormError message={error} />
          </div>
        )}
        <Section title="Details" description="When the batch runs and how many learners can join. Session times are in the batch timezone.">
          <CoreFields values={values} set={set} errors={fieldErrors} categories={categories} />
        </Section>
        <Section title="Batch overview" description="What learners see on the batch page.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Short Description" htmlFor="description" required error={fieldErrors.description} hint="Shown on batch cards (max 500 characters).">
              <Textarea id="description" name="description" rows={5} maxLength={500} value={values.description} onChange={(e) => set("description", e.target.value)} placeholder="Short description of the batch" invalid={!!fieldErrors.description} required />
            </Field>
            <Field label="Instructors" required error={fieldErrors.instructorIds}>
              <PeoplePicker name="instructorIds" options={instructors} value={values.instructorIds} onChange={(v) => set("instructorIds", v)} invalid={!!fieldErrors.instructorIds} placeholder="Select instructors" />
            </Field>
            <Field label="Batch Details" htmlFor="details" required error={fieldErrors.details} className="lg:col-span-2">
              <MarkdownField id="details" name="details" value={values.details} onChange={(v) => set("details", v)} rows={8} invalid={!!fieldErrors.details} placeholder="Schedule, what's included, prerequisites…" required />
            </Field>
          </div>
        </Section>
        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-ink-muted">The batch is created unpublished. You can add courses, classes and pricing next.</p>
          <div className="flex gap-2">
            <ButtonLink href="/admin/batches" variant="outline">
              Cancel
            </ButtonLink>
            <Button type="submit" loading={pending} title="Save (Ctrl/⌘ + S)">
              Save
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

interface SettingsValues extends CoreValues {
  slug: string;
  imageUrl: string;
  published: boolean;
  allowSelfEnrollment: boolean;
  allowFuture: boolean;
  showLiveClass: boolean;
  certification: boolean;
  evaluationEndDate: string;
  paidBatch: boolean;
  amount: string;
  currency: string;
  conferencingProvider: string;
}

function toSettingsValues(batch: Batch): SettingsValues {
  return {
    title: batch.title,
    slug: batch.slug,
    startDate: batch.startDate,
    endDate: batch.endDate,
    startTime: batch.startTime,
    endTime: batch.endTime,
    timezone: batch.timezone,
    categoryId: batch.categoryId ?? "",
    seatCount: String(batch.seatCount ?? 0),
    medium: batch.medium,
    description: batch.description,
    details: batch.details,
    instructorIds: batch.instructorIds,
    imageUrl: batch.imageUrl ?? "",
    published: batch.published,
    allowSelfEnrollment: batch.allowSelfEnrollment,
    allowFuture: batch.allowFuture,
    showLiveClass: batch.showLiveClass,
    certification: batch.certification,
    evaluationEndDate: batch.evaluationEndDate ?? "",
    paidBatch: batch.paidBatch,
    amount: batch.amount ? String(batch.amount / 100) : "",
    currency: batch.currency || "USD",
    conferencingProvider: batch.conferencingProvider ?? "",
  };
}

export function BatchSettingsForm({
  batch,
  categories,
  instructors,
  studentCount,
  certificatesEnabled,
}: {
  batch: Batch;
  categories: Option[];
  instructors: Option[];
  studentCount: number;
  certificatesEnabled: boolean;
}) {
  const [values, setValues] = useState<SettingsValues>(() => toSettingsValues(batch));
  const [saved, setSaved] = useState<SettingsValues>(values);
  const [slugTouched, setSlugTouched] = useState(batch.slug !== slugify(batch.title));
  const submitted = useRef<SettingsValues>(values);
  const formRef = useRef<HTMLFormElement>(null);
  const { submit, pending, error, fieldErrors } = useActionForm(updateBatchAction, { onSuccess: () => setSaved(submitted.current) });

  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) =>
    setValues((v) => {
      const next = { ...v, [key]: value };
      if (key === "title" && !slugTouched) next.slug = slugify(String(value) || "batch");
      return next;
    });
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

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

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitted.current = values;
    submit(new FormData(e.currentTarget));
  };

  const slugChanged = values.slug !== saved.slug;

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
      <input type="hidden" name="batchId" value={batch.id} />
      <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border sm:bg-surface-1/95 sm:px-5">
        <div className="flex items-center gap-2 text-sm">
          {dirty ? (
            <Badge tone="warning" dot>
              Not Saved
            </Badge>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <Icon.CheckCircle className="size-4 text-success" /> All changes saved
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => setValues(saved)} disabled={pending}>
              Discard
            </Button>
          )}
          <Button type="submit" loading={pending} disabled={!dirty && !error} title="Save (Ctrl/⌘ + S)">
            Save
          </Button>
        </div>
      </div>
      <FormError message={error} />

      <Card>
        <Section title="Details">
          <CoreFields values={values} set={(key, value) => set(key, value as never)} errors={fieldErrors} categories={categories} />
          <Field
            label="URL"
            htmlFor="slug"
            error={fieldErrors.slug}
            hint={slugChanged && batch.published ? "Changing the URL of a published batch breaks links people already have." : `Batch page: /batches/${values.slug || "…"}`}
            className="mt-4"
          >
            <Input
              id="slug"
              name="slug"
              value={values.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value.toLowerCase());
              }}
              invalid={!!fieldErrors.slug}
            />
          </Field>
        </Section>

        <Section title="Enrollment & Certification">
          <div className="space-y-4">
            <Switch name="published" checked={values.published} onChange={(e) => set("published", e.target.checked)} label="Published" description="Show this batch on the batches page and allow enrollment." />
            <Switch
              name="allowSelfEnrollment"
              checked={values.allowSelfEnrollment}
              onChange={(e) => set("allowSelfEnrollment", e.target.checked)}
              label="Allow Self Enrollment"
              description="Allow users to enroll in this batch on their own."
            />
            <Switch
              name="allowFuture"
              checked={values.allowFuture}
              onChange={(e) => set("allowFuture", e.target.checked)}
              label="Allow late enrollment"
              description="Keep enrollment open after the batch has started (until it ends)."
            />
            <Switch name="paidBatch" checked={values.paidBatch} onChange={(e) => set("paidBatch", e.target.checked)} label="Paid Batch" description="Charge a fee for batch enrollment." />
            {values.paidBatch && (
              <div className="grid gap-4 rounded-lg border border-border bg-surface-2/50 p-4 sm:grid-cols-2">
                <Field label="Amount" htmlFor="amount" required error={fieldErrors.amount}>
                  <Input id="amount" name="amount" type="number" min={0} step="0.01" inputMode="decimal" value={values.amount} onChange={(e) => set("amount", e.target.value)} invalid={!!fieldErrors.amount} placeholder="199.00" />
                </Field>
                <Field label="Currency" htmlFor="currency" required error={fieldErrors.currency}>
                  <Select id="currency" name="currency" value={values.currency} onChange={(e) => set("currency", e.target.value)} invalid={!!fieldErrors.currency}>
                    {Array.from(new Set([values.currency, ...currencies])).filter(Boolean).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
            {!values.paidBatch && <input type="hidden" name="currency" value={values.currency} />}
            <Switch
              name="certification"
              checked={values.certification}
              onChange={(e) => set("certification", e.target.checked)}
              label="Certification"
              description={certificatesEnabled ? "Issue certificates to batch participants." : "Certificates are disabled in the platform settings."}
            />
            {values.certification && (
              <div className="grid gap-4 rounded-lg border border-border bg-surface-2/50 p-4 sm:grid-cols-2">
                <Field label="Evaluation End Date" htmlFor="evaluationEndDate" error={fieldErrors.evaluationEndDate} hint="Last day learners can be evaluated for a certificate.">
                  <Input id="evaluationEndDate" name="evaluationEndDate" type="date" min={values.endDate || undefined} value={values.evaluationEndDate} onChange={(e) => set("evaluationEndDate", e.target.value)} invalid={!!fieldErrors.evaluationEndDate} />
                </Field>
                <div className="flex items-end">
                  <ButtonLink href={`/admin/certificates/bulk?batch=${batch.id}`} variant="outline" leftIcon={<Icon.Award className="size-4" />}>
                    Generate certificates
                  </ButtonLink>
                </div>
              </div>
            )}
            {!values.certification && values.evaluationEndDate && <input type="hidden" name="evaluationEndDate" value={values.evaluationEndDate} />}
          </div>
        </Section>

        <Section title="Batch overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Instructors" required error={fieldErrors.instructorIds}>
              <PeoplePicker name="instructorIds" options={instructors} value={values.instructorIds} onChange={(v) => set("instructorIds", v)} invalid={!!fieldErrors.instructorIds} placeholder="Select instructors" />
            </Field>
            <div className="space-y-4">
              <Field label="Short Description" htmlFor="description" required error={fieldErrors.description}>
                <Textarea id="description" name="description" rows={4} maxLength={500} value={values.description} onChange={(e) => set("description", e.target.value)} placeholder="Short description of the batch" invalid={!!fieldErrors.description} />
              </Field>
              <FileUpload name="imageUrl" kind="image" label="Cover image" value={values.imageUrl} onChange={(url) => set("imageUrl", url)} hint="Shown on batch cards and the batch page. 16:9 works best." />
              {fieldErrors.imageUrl && <p className="text-xs text-danger">{fieldErrors.imageUrl}</p>}
            </div>
            <Field label="Batch Details" htmlFor="details" required error={fieldErrors.details} className="lg:col-span-2">
              <MarkdownField id="details" name="details" value={values.details} onChange={(v) => set("details", v)} rows={10} invalid={!!fieldErrors.details} />
            </Field>
          </div>
        </Section>

        <Section title="Live classes" description="Classes are scheduled from the Classes tab; paste the meeting link from your provider.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Conferencing Provider" htmlFor="conferencingProvider" hint="Used as the default for new live classes.">
              <Select id="conferencingProvider" name="conferencingProvider" value={values.conferencingProvider} onChange={(e) => set("conferencingProvider", e.target.value)}>
                <option value="">Not set</option>
                <option value="zoom">Zoom</option>
                <option value="google_meet">Google Meet</option>
                <option value="custom">Other (custom link)</option>
              </Select>
            </Field>
            <div className="flex items-center">
              <Switch
                name="showLiveClass"
                checked={values.showLiveClass}
                onChange={(e) => set("showLiveClass", e.target.checked)}
                label="Show live classes in timetable"
                description="Add every scheduled class to the batch timetable automatically."
                className="w-full"
              />
            </div>
          </div>
        </Section>
      </Card>

      <p className={cn("text-xs text-ink-muted", !studentCount && "hidden")}>
        {studentCount} student{studentCount === 1 ? " is" : "s are"} enrolled. Seat count can&apos;t go below that. Learners are notified when you publish.{" "}
        <Link href={`/batches/${values.slug}`} className="text-accent hover:underline">
          View batch page
        </Link>
      </p>
    </form>
  );
}

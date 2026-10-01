"use client";

import { useId, useState } from "react";
import { applyToTeachAction, updateTeachPayoutEmailAction } from "@/lib/actions/marketplace";
import { MARKETPLACE_LIMITS, type InstructorApplication } from "@/lib/teaching/marketplace-shared";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, Textarea } from "@/components/ui/input";
import { useFormAction } from "@/components/admin/settings/use-form-action";

/**
 * Instructor application form on /teach: bio, subjects, a teaching sample
 * (link and/or outline) and the payout email. Also used to edit a pending
 * application and to resubmit after a rejection.
 */
export function TeachApplicationForm({
  initial,
  payoutEmail,
  sharePercent,
  submitLabel,
}: {
  initial: InstructorApplication | null;
  payoutEmail: string;
  sharePercent: number;
  submitLabel: string;
}) {
  const id = useId();
  const L = MARKETPLACE_LIMITS;
  const { onSubmit, pending, errors, formError } = useFormAction(applyToTeachAction);
  const [bioLength, setBioLength] = useState(initial?.bio.length ?? 0);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field
        label="About you"
        htmlFor={`${id}-bio`}
        required
        error={errors.bio}
        hint={`Your background and teaching experience. ${bioLength}/${L.bioMax} characters (at least ${L.bioMin}).`}
      >
        <Textarea
          id={`${id}-bio`}
          name="bio"
          rows={6}
          maxLength={L.bioMax}
          defaultValue={initial?.bio ?? ""}
          onChange={(e) => setBioLength(e.currentTarget.value.length)}
          invalid={!!errors.bio}
        />
      </Field>
      <Field label="Subjects you can teach" htmlFor={`${id}-expertise`} required error={errors.expertise} hint={`Separate with commas, up to ${L.expertiseMax}. For example: Python, Data analysis, SQL.`}>
        <Input id={`${id}-expertise`} name="expertise" defaultValue={initial?.expertise.join(", ") ?? ""} maxLength={600} invalid={!!errors.expertise} autoComplete="off" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Sample link" htmlFor={`${id}-url`} error={errors.sampleUrl} hint="A video, a published lesson, a talk or your portfolio.">
          <Input id={`${id}-url`} name="sampleUrl" type="url" inputMode="url" placeholder="https://" defaultValue={initial?.sampleUrl ?? ""} maxLength={L.urlMax} invalid={!!errors.sampleUrl} />
        </Field>
        <Field label="Payout email" htmlFor={`${id}-payout`} required error={errors.payoutEmail} hint="Where we send your earnings.">
          <Input id={`${id}-payout`} name="payoutEmail" type="email" autoComplete="email" defaultValue={payoutEmail} maxLength={L.emailMax} invalid={!!errors.payoutEmail} />
        </Field>
      </div>
      <Field label="Sample lesson outline" htmlFor={`${id}-sample`} error={errors.sample} hint="Optional when you shared a link: the outline of a course or lesson you would like to teach.">
        <Textarea id={`${id}-sample`} name="sample" rows={5} maxLength={L.sampleMax} defaultValue={initial?.sample ?? ""} invalid={!!errors.sample} />
      </Field>
      <div>
        <Checkbox
          id={`${id}-agree`}
          name="agree"
          value="1"
          label="I agree to the instructor terms"
          description={`You keep ${sharePercent}% of the net revenue (after discounts, taxes and refunds) of the courses you teach. Payouts are sent to your payout email.`}
        />
        {errors.agree && <p className="mt-1.5 text-xs text-danger">{errors.agree}</p>}
      </div>
      <FormError message={formError && !Object.keys(errors).length ? formError : null} />
      <div className="flex justify-end">
        <Button type="submit" loading={pending} className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Payout email of an instructor (on /teach and /teach/earnings). */
export function TeachPayoutEmailForm({ payoutEmail }: { payoutEmail: string }) {
  const id = useId();
  const { onSubmit, pending, errors } = useFormAction(updateTeachPayoutEmailAction);
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <label htmlFor={`${id}-email`} className="sr-only">
          Payout email
        </label>
        <Input id={`${id}-email`} name="payoutEmail" type="email" autoComplete="email" defaultValue={payoutEmail} maxLength={MARKETPLACE_LIMITS.emailMax} invalid={!!errors.payoutEmail} />
        {errors.payoutEmail && <p className="mt-1.5 text-xs text-danger">{errors.payoutEmail}</p>}
      </div>
      <Button type="submit" variant="outline" loading={pending}>
        Save
      </Button>
    </form>
  );
}

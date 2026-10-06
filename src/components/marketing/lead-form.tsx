"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useRef, type FormEvent } from "react";
import type { ActionResult } from "@/lib/types";
import { type LeadSubmitStatus, submitLeadAction } from "@/lib/actions/leads";
import { track } from "@/components/seo/tracking-client";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export interface LeadFormProps {
  /** Where the form is ("blog", "course", "footer", "free"); stored on the lead. */
  source: string;
  /** The course the visitor asks about (the syllabus is emailed after confirmation). */
  courseId?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  /** "card": boxed block in a page; "compact": one row (footer); "hero": large, for /free. */
  variant?: "card" | "compact" | "hero";
  /** Ask for a first name (off in the compact variant). */
  askName?: boolean;
  /** Privacy policy link shown with the consent checkbox. */
  privacyHref?: string;
  className?: string;
}

type State = ActionResult<{ status: LeadSubmitStatus }> | null;

/**
 * Email capture with double opt-in. Email, optional name and an explicit
 * consent checkbox; a hidden honeypot field and the time the form was on
 * screen keep bots out (the server also rate-limits by IP and by address).
 * After submitting, the visitor sees a "check your inbox" state and a
 * `generate_lead` event is sent to the tags they consented to.
 */
export function LeadForm({
  source,
  courseId,
  title: titleProp,
  description: descriptionProp,
  submitLabel: submitLabelProp,
  variant = "card",
  askName = variant !== "compact",
  privacyHref,
  className,
}: LeadFormProps) {
  // `global.` keys: the compact form is in the site footer on every page.
  const t = useT("public");
  const title = titleProp ?? t("global.leadForm.title");
  const description = descriptionProp ?? t("global.leadForm.description");
  const submitLabel = submitLabelProp ?? t("global.leadForm.submit");
  const id = useId();
  const mountedAt = useRef(0);
  const doneRef = useRef<HTMLDivElement>(null);
  const [state, formAction, pending] = useActionState<State, FormData>(submitLeadAction, null);
  const done = state?.ok === true;
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const formError = state && !state.ok && !Object.keys(errors).length ? state.error : null;

  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

  useEffect(() => {
    if (!done) return;
    doneRef.current?.focus();
    track("generate_lead", { source, course_id: courseId });
  }, [done, source, courseId]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("renderedAt", String(mountedAt.current));
    startTransition(() => formAction(formData));
  };

  const hero = variant === "hero";
  const compact = variant === "compact";

  if (done) {
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className={cn(
          "flex items-start gap-3 outline-none",
          !compact && "rounded-card border border-success/30 bg-success/8 p-5",
          compact && "rounded-xl bg-success/10 px-3 py-2.5",
          className,
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <Icon.Mail className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 text-sm">
          {/* One answer for every address (new, pending or already subscribed), so the form reveals nothing about who is on the list. */}
          <p className="font-semibold text-ink">{t("global.leadForm.checkInboxTitle")}</p>
          <p className="mt-0.5 text-ink-muted">{t("global.leadForm.checkInboxBody")}</p>
        </div>
      </div>
    );
  }

  const honeypot = (
    <div aria-hidden="true" className="absolute -start-[10000px] top-auto size-px overflow-hidden">
      <label htmlFor={`${id}-website`}>{t("global.leadForm.honeypot")}</label>
      <input id={`${id}-website`} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );

  const consent = (
    <div>
      <label htmlFor={`${id}-consent`} className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-ink-muted">
        <input
          id={`${id}-consent`}
          type="checkbox"
          name="consent"
          value="on"
          required
          aria-invalid={errors.consent ? true : undefined}
          aria-describedby={errors.consent ? `${id}-consent-error` : undefined}
          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border-strong accent-accent"
        />
        <span>
          {courseId ? t("global.leadForm.consentSyllabus") : t("global.leadForm.consent")}
          {privacyHref && (
            <>
              {" "}
              <Link href={privacyHref} className="font-medium text-accent hover:underline">
                {t("global.leadForm.privacy")}
              </Link>
            </>
          )}
        </span>
      </label>
      {errors.consent && (
        <p id={`${id}-consent-error`} className="mt-1 text-xs text-danger" role="alert">
          {errors.consent}
        </p>
      )}
    </div>
  );

  const emailField = (
    <div className="min-w-0 flex-1">
      <label htmlFor={`${id}-email`} className={cn(compact || hero ? "sr-only" : "mb-1 block text-sm font-medium text-ink")}>
        {t("global.leadForm.email")}
      </label>
      <Input
        id={`${id}-email`}
        type="email"
        name="email"
        required
        autoComplete="email"
        inputMode="email"
        maxLength={254}
        placeholder={t("global.leadForm.emailPlaceholder")}
        invalid={!!errors.email}
        aria-describedby={errors.email ? `${id}-email-error` : undefined}
        leftAddon={<Icon.Mail className="size-4" />}
        className={cn(hero && "h-11 text-base")}
      />
      {errors.email && (
        <p id={`${id}-email-error`} className="mt-1 text-xs text-danger" role="alert">
          {errors.email}
        </p>
      )}
    </div>
  );

  const nameField = askName ? (
    <div className="min-w-0 flex-1">
      <label htmlFor={`${id}-name`} className={cn(hero ? "sr-only" : "mb-1 block text-sm font-medium text-ink")}>
        {t.rich("global.leadForm.firstName", { muted: (chunks) => <span className="font-normal text-ink-muted">{chunks}</span> })}
      </label>
      <Input
        id={`${id}-name`}
        name="name"
        autoComplete="given-name"
        maxLength={120}
        placeholder={hero ? t("global.leadForm.firstNameOptional") : t("global.leadForm.firstNamePlaceholder")}
        className={cn(hero && "h-11 text-base")}
      />
    </div>
  ) : null;

  const form = (
    <form onSubmit={onSubmit} noValidate className="relative space-y-3" aria-label={title}>
      <input type="hidden" name="source" value={source} />
      {courseId && <input type="hidden" name="courseId" value={courseId} />}
      {honeypot}
      <div className={cn("flex flex-col gap-2", (compact || hero) && "sm:flex-row sm:items-start")}>
        {nameField}
        {emailField}
        <Button type="submit" loading={pending} size={hero ? "lg" : "md"} className={cn("shrink-0", !compact && !hero && "sm:self-end")}>
          {submitLabel}
        </Button>
      </div>
      {consent}
      {formError && (
        <p className="text-xs text-danger" role="alert">
          {formError}
        </p>
      )}
    </form>
  );

  if (compact) return <div className={className}>{form}</div>;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(hero ? "rounded-3xl border border-accent/25 bg-surface-1 p-5 shadow-pop sm:p-8" : "rounded-card border border-border bg-surface-1 p-5 shadow-card sm:p-6", className)}
    >
      <div className="mb-4 flex items-start gap-3">
        {!hero && (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon.Gift className="size-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h2 id={`${id}-title`} className={cn("font-semibold tracking-tight text-ink", hero ? "text-xl sm:text-2xl" : "text-lg")}>
            {title}
          </h2>
          {description && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>}
        </div>
      </div>
      {form}
    </section>
  );
}

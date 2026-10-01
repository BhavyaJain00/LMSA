"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionResult, PublicUser } from "@/lib/types";
import { updateCourseSettingsAction } from "@/lib/actions/courses";
import type { PrerequisiteSettings } from "@/lib/actions/drip";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormError, Input, Select, Switch, Textarea, type InputProps } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { CourseSettingsValues } from "./types";
import { UnsavedChangesGuard } from "./unsaved-changes-guard";
import { CREATE_MEMBER_OPTION, CreateMemberDialog, memberQualifies } from "./create-member-dialog";
import { CERTIFICATE_TEMPLATES } from "@/components/certificates/templates";
import { CoursePrerequisitesField, usePrerequisiteField } from "./course-prerequisites-field";
import { CourseAiTutorField, useCourseAiTutorField } from "@/components/ai/course-ai-tutor-field";

export interface CourseSettingsFormProps {
  courseId: string;
  initial: CourseSettingsValues;
  evaluators: PublicUser[];
  currencies: readonly string[];
  paymentsConfigured: boolean;
  canManagePayments: boolean;
  /** Moderators can add a new evaluator without leaving the form. */
  canCreateMembers?: boolean;
  canGrantAdmin?: boolean;
  /** Current prerequisites and pickable courses; loaded by the form when omitted. */
  prerequisites?: PrerequisiteSettings | null;
}

const META_DESCRIPTION_MAX = 160;

const toMajor = (cents: number) => (cents > 0 ? (cents / 100).toFixed(2).replace(/\.00$/, "") : "");

function MoneyInput({ currency, ...props }: InputProps & { currency: string }) {
  return (
    <div className="flex">
      <span className="inline-flex min-w-12 items-center justify-center rounded-l-lg border border-r-0 border-border-strong bg-surface-2 px-2.5 text-xs font-medium text-ink-muted">{currency || "¤"}</span>
      <Input {...props} className="rounded-l-none" />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="space-y-5">{children}</CardBody>
    </Card>
  );
}

export function CourseSettingsForm({
  courseId,
  initial,
  evaluators: initialEvaluators,
  currencies,
  paymentsConfigured,
  canManagePayments,
  canCreateMembers = false,
  canGrantAdmin = false,
  prerequisites: providedPrerequisites,
}: CourseSettingsFormProps) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [upcoming, setUpcoming] = useState(initial.upcoming);
  const [featured, setFeatured] = useState(initial.featured);
  const [selfEnrollment, setSelfEnrollment] = useState(!initial.disableSelfLearning);
  const [enforceLessonCompletion, setEnforceLessonCompletion] = useState(initial.enforceLessonCompletion);
  const [paidCourse, setPaidCourse] = useState(initial.paidCourse);
  const [price, setPrice] = useState(toMajor(initial.price));
  const [currency, setCurrency] = useState(initial.currency);
  const [enableCertification, setEnableCertification] = useState(initial.enableCertification);
  const [paidCertificate, setPaidCertificate] = useState(initial.paidCertificate);
  const [certificatePrice, setCertificatePrice] = useState(toMajor(initial.certificatePrice));
  const [evaluatorId, setEvaluatorId] = useState(initial.evaluatorId ?? "");
  const [metaDescription, setMetaDescription] = useState(initial.metaDescription ?? "");
  const [metaKeywords, setMetaKeywords] = useState(initial.metaKeywords ?? "");
  const [paymentsDialog, setPaymentsDialog] = useState(false);
  const [memberDialog, setMemberDialog] = useState(false);
  const [evaluators, setEvaluators] = useState(initialEvaluators);
  const prerequisites = usePrerequisiteField(courseId, providedPrerequisites);
  const aiTutor = useCourseAiTutorField(courseId);

  const snapshot = JSON.stringify([upcoming, featured, selfEnrollment, enforceLessonCompletion, paidCourse, paidCourse ? price : "", currency, enableCertification, paidCertificate, paidCertificate ? certificatePrice : "", paidCertificate ? evaluatorId : "", metaDescription.trim(), metaKeywords.trim()]);
  const [baseline] = useState(() =>
    JSON.stringify([
      initial.upcoming,
      initial.featured,
      !initial.disableSelfLearning,
      initial.enforceLessonCompletion,
      initial.paidCourse,
      initial.paidCourse ? toMajor(initial.price) : "",
      initial.currency,
      initial.enableCertification,
      initial.paidCertificate,
      initial.paidCertificate ? toMajor(initial.certificatePrice) : "",
      initial.paidCertificate ? (initial.evaluatorId ?? "") : "",
      (initial.metaDescription ?? "").trim(),
      (initial.metaKeywords ?? "").trim(),
    ]),
  );
  const dirty = snapshot !== baseline || prerequisites.dirty || aiTutor.dirty;

  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData): Promise<ActionResult | null> => {
    const result = await updateCourseSettingsAction(null, formData);
    if (!result) return prev;
    if (result.ok) toast.success(result.message ?? "Course updated successfully");
    else toast.error(result.error);
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

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

  /** Turning on paid options needs a payment gateway (unless it was already on). */
  const guardPayments = (wasOn: boolean, next: boolean): boolean => {
    if (next && !wasOn && !paymentsConfigured) {
      setPaymentsDialog(true);
      return false;
    }
    return true;
  };

  const currencySelect = (
    <Field label="Currency" htmlFor="settings-currency" required error={errors.currency}>
      <Select id="settings-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} invalid={!!errors.currency}>
        <option value="">Select currency</option>
        {currencies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-6" noValidate>
      <UnsavedChangesGuard dirty={dirty && !pending} />
      <input type="hidden" name="courseId" value={courseId} />
      <FormError message={state && !state.ok ? state.error : null} />

      <Section title="Visibility" description="Control how learners find and enroll in this course.">
        <Switch name="upcoming" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} label="Upcoming" description="Not yet open for enrollment." />
        <Switch name="featured" checked={featured} onChange={(e) => setFeatured(e.target.checked)} label="Featured" description="Highlight on the homepage." />
        <Switch name="selfEnrollment" checked={selfEnrollment} onChange={(e) => setSelfEnrollment(e.target.checked)} label="Self enrollment" description="Let users enroll themselves. When off, only admins (or batches) can enroll learners." />
        <Switch
          name="enforceLessonCompletion"
          checked={enforceLessonCompletion}
          onChange={(e) => setEnforceLessonCompletion(e.target.checked)}
          label="Enforce Lesson Completion"
          description="Students must complete each lesson before the next one opens."
        />
      </Section>

      <Section title="Prerequisites" description="Courses learners must complete before they can enroll in this one.">
        <CoursePrerequisitesField state={prerequisites} error={errors.prerequisiteCourseIds} />
      </Section>

      <Section title="AI tutor" description="A course-grounded teaching assistant learners can ask while they study.">
        <CourseAiTutorField courseId={courseId} state={aiTutor} />
      </Section>

      <Section title="Pricing and certification" description="Charge for the course or its certificate, and choose how certificates are issued.">
        <div className="space-y-4">
          <Switch
            name="paidCourse"
            checked={paidCourse}
            onChange={(e) => {
              const next = e.target.checked;
              if (!guardPayments(initial.paidCourse, next)) return;
              setPaidCourse(next);
              if (next) setPaidCertificate(false);
            }}
            label="Paid course"
            description="Charge learners to enroll in this course."
          />
          {errors.paidCourse && <p className="text-xs text-danger">{errors.paidCourse}</p>}
          {paidCourse && (
            <div className="grid gap-4 rounded-xl border border-border bg-surface-2/50 p-4 sm:grid-cols-2">
              {currencySelect}
              <Field label="Course price" htmlFor="settings-price" required error={errors.price} hint="Learners pay this once to enroll.">
                <MoneyInput
                  id="settings-price"
                  name="price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="49.00"
                  invalid={!!errors.price}
                  currency={currency}
                />
              </Field>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-5">
          <Switch
            name="enableCertification"
            checked={enableCertification}
            onChange={(e) => {
              setEnableCertification(e.target.checked);
              if (e.target.checked) setPaidCertificate(false);
            }}
            label="Completion certificate"
            description="Issue a free certificate when learners complete the course."
          />
          {errors.enableCertification && <p className="mt-1.5 text-xs text-danger">{errors.enableCertification}</p>}
        </div>

        {!paidCourse && (
          <div className="space-y-4">
            <Switch
              name="paidCertificate"
              checked={paidCertificate}
              onChange={(e) => {
                const next = e.target.checked;
                if (!guardPayments(initial.paidCertificate, next)) return;
                setPaidCertificate(next);
                if (next) setEnableCertification(false);
              }}
              label="Paid certificate"
              description="Sell an evaluator-graded certificate alongside this free course."
            />
            {errors.paidCertificate && <p className="text-xs text-danger">{errors.paidCertificate}</p>}
            {paidCertificate && (
              <div className="grid gap-4 rounded-xl border border-border bg-surface-2/50 p-4 sm:grid-cols-2">
                {currencySelect}
                <Field label="Certificate price" htmlFor="settings-cert-price" required error={errors.certificatePrice}>
                  <MoneyInput
                    id="settings-cert-price"
                    name="certificatePrice"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={certificatePrice}
                    onChange={(e) => setCertificatePrice(e.target.value)}
                    placeholder="15.00"
                    invalid={!!errors.certificatePrice}
                    currency={currency}
                  />
                </Field>
                <Field label="Evaluator" htmlFor="settings-evaluator" required error={errors.evaluatorId} hint="Learners book an evaluation with this person to earn the certificate." className="sm:col-span-2">
                  <Select
                    id="settings-evaluator"
                    name="evaluatorId"
                    value={evaluatorId}
                    onChange={(e) => {
                      if (e.target.value === CREATE_MEMBER_OPTION) setMemberDialog(true);
                      else setEvaluatorId(e.target.value);
                    }}
                    invalid={!!errors.evaluatorId}
                  >
                    <option value="">Select evaluator</option>
                    {evaluators.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                    {canCreateMembers && <option value={CREATE_MEMBER_OPTION}>+ Add New Member…</option>}
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}
        {(enableCertification || paidCertificate) && (
          <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
            <Icon.Certificate className="mt-px size-4 shrink-0" />
            <span>
              Certificates render from a template ({CERTIFICATE_TEMPLATES.map((t) => t.name).join(", ")}) chosen when they are issued or evaluated; certificates issued automatically use{" "}
              {CERTIFICATE_TEMPLATES[0]!.name}. Every certificate can be verified publicly with its code.{" "}
              <Link href="/admin/certificates" className="font-medium text-ink underline underline-offset-2">
                Manage certificates
              </Link>
            </span>
          </p>
        )}
      </Section>

      <Section title="Meta Tags" description="These tags help search engines describe and rank your course in results.">
        <Field
          label="Meta description"
          htmlFor="settings-meta-description"
          error={errors.metaDescription}
          hint={`${metaDescription.length}/${META_DESCRIPTION_MAX} · Shown under the course title in search results.`}
        >
          <Textarea
            id="settings-meta-description"
            name="metaDescription"
            rows={3}
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
            maxLength={META_DESCRIPTION_MAX}
            placeholder="A short summary of the course for search results."
            invalid={!!errors.metaDescription}
          />
        </Field>
        <Field label="Meta keywords" htmlFor="settings-meta-keywords" error={errors.metaKeywords} hint="Separate keywords with commas.">
          <Textarea
            id="settings-meta-keywords"
            name="metaKeywords"
            rows={2}
            value={metaKeywords}
            onChange={(e) => setMetaKeywords(e.target.value)}
            maxLength={500}
            placeholder="Comma separated keywords for SEO"
            invalid={!!errors.metaKeywords}
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {dirty && (
          <Badge tone="warning" dot>
            Not Saved
          </Badge>
        )}
        <Button type="submit" loading={pending} disabled={!dirty} title={dirty ? "Save (Ctrl+S)" : "No changes to save"} leftIcon={<Icon.Check className="size-4" />}>
          Save settings
        </Button>
      </div>

      <Dialog
        open={paymentsDialog}
        onClose={() => setPaymentsDialog(false)}
        title="Payments not configured"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPaymentsDialog(false)}>
              Close
            </Button>
            {canManagePayments && (
              <ButtonLink href="/admin/settings/payments" variant="primary">
                Open payment settings
              </ButtonLink>
            )}
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Selling a paid course or certificate needs a payment gateway. {canManagePayments ? "Choose one in the platform settings, then turn on pricing here." : "Ask an administrator to configure one, then turn on pricing here."}
        </p>
      </Dialog>
      <CreateMemberDialog
        open={memberDialog}
        onClose={() => setMemberDialog(false)}
        purpose="evaluator"
        canGrantAdmin={canGrantAdmin}
        onCreated={(user) => {
          if (!memberQualifies(user, "evaluator")) return;
          setEvaluators((list) => (list.some((u) => u.id === user.id) ? list : [...list, user].sort((a, b) => a.name.localeCompare(b.name))));
          setEvaluatorId(user.id);
        }}
      />
    </form>
  );
}

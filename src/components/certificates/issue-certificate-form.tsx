"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import type { CertificateFormOptions } from "@/lib/data/certificates";
import { issueCertificateAction } from "@/lib/actions/certificates";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, FormError, Input, RadioCard, Select, Switch } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";

export function IssueCertificateForm({
  options,
  today,
  defaults,
}: {
  options: CertificateFormOptions;
  today: string;
  defaults: { userId?: string; courseId?: string; batchId?: string };
}) {
  const [state, formAction, pending] = useActionState<ActionResult<{ code: string }> | null, FormData>(issueCertificateAction, null);
  const [target, setTarget] = useState<"course" | "batch">(defaults.batchId && !defaults.courseId ? "batch" : "course");
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState(defaults.userId ?? "");
  const [issueDate, setIssueDate] = useState(today);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  const q = query.trim().toLowerCase();
  const learners = q ? options.learners.filter((l) => l.label.toLowerCase().includes(q) || l.value === userId) : options.learners;

  return (
    <form action={formAction} noValidate>
      <Card>
        <CardHeader title="Issue a certificate" description="The learner is notified and the certificate gets a public verification link." />
        <CardBody className="space-y-5">
          <FormError message={state && !state.ok ? state.error : null} />

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium text-ink">
              Learner<span className="ml-0.5 text-danger">*</span>
            </legend>
            <Input
              type="search"
              aria-label="Search learners"
              placeholder="Search by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              leftAddon={<Icon.Search className="size-4" />}
            />
            <Select name="userId" aria-label="Learner" value={userId} onChange={(e) => setUserId(e.target.value)} invalid={!!errors?.userId}>
              <option value="">{learners.length ? "Select a learner" : "No learners match your search"}</option>
              {learners.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
            {errors?.userId && <p className="text-xs text-danger">{errors.userId}</p>}
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Certificate for</legend>
            <input type="hidden" name="target" value={target} />
            <div className="grid gap-2 sm:grid-cols-2">
              <RadioCard
                name="target-choice"
                value="course"
                checked={target === "course"}
                onChange={() => setTarget("course")}
                title="A course"
                description="Requires the learner to be enrolled."
                icon={<Icon.BookOpen className="size-4" />}
              />
              <RadioCard
                name="target-choice"
                value="batch"
                checked={target === "batch"}
                onChange={() => setTarget("batch")}
                title="A batch"
                description="Requires the learner to be in the batch."
                icon={<Icon.Users className="size-4" />}
              />
            </div>
          </fieldset>

          {target === "course" ? (
            <div className="space-y-3">
              <Field label="Course" htmlFor="cert-course" required error={errors?.courseId}>
                <Select id="cert-course" name="courseId" defaultValue={defaults.courseId ?? ""} invalid={!!errors?.courseId}>
                  <option value="">Select a course</option>
                  {options.courses.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Checkbox
                id="cert-allow-incomplete"
                name="allowIncomplete"
                label="Issue even if the learner hasn't completed the course"
                description="Completion-certificate courses normally require 100% progress."
              />
            </div>
          ) : (
            <Field label="Batch" htmlFor="cert-batch" required error={errors?.batchId}>
              <Select id="cert-batch" name="batchId" defaultValue={defaults.batchId ?? ""} invalid={!!errors?.batchId}>
                <option value="">Select a batch</option>
                {options.batches.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Issue Date" htmlFor="cert-issue" required error={errors?.issueDate}>
              <Input id="cert-issue" name="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} invalid={!!errors?.issueDate} />
            </Field>
            <Field label="Expiry Date" htmlFor="cert-expiry" error={errors?.expiryDate} hint="Optional. Leave empty if it never expires.">
              <Input id="cert-expiry" name="expiryDate" type="date" min={issueDate || undefined} invalid={!!errors?.expiryDate} />
            </Field>
          </div>

          <Field label="Evaluator" htmlFor="cert-evaluator" error={errors?.evaluatorId} hint="Optional. Shown as “Evaluated By” on the certificate.">
            <Select id="cert-evaluator" name="evaluatorId" defaultValue="" invalid={!!errors?.evaluatorId}>
              <option value="">No evaluator (show instructors)</option>
              {options.evaluators.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>

          <Switch id="cert-published" name="published" defaultChecked label="Published" description="Make this certificate visible on the certified members page." />
        </CardBody>
        <CardFooter>
          <Link href="/admin/certificates" className="inline-flex h-9.5 items-center rounded-lg px-4 text-sm font-medium text-ink hover:bg-surface-2">
            Cancel
          </Link>
          <Button type="submit" loading={pending} leftIcon={<Icon.Certificate className="size-4" />}>
            Issue certificate
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

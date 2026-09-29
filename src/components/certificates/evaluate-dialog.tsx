"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import type { ActionResult, CertificateEvaluation } from "@/lib/types";
import type { ScheduleEvent } from "@/lib/data/certificates";
import { saveEvaluationAction, saveEvaluationCertificateAction, updateMeetingLinkAction } from "@/lib/actions/evaluations";
import { Dialog } from "@/components/ui/dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormError, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { LocalDateTime } from "@/components/assessments/client-time";
import { submitWithoutReset } from "@/components/assessments/form-submit";
import { StarRatingInput } from "./star-rating";
import { CertificateTemplateField } from "./template-field";
import { formatClock12, formatShortDate } from "./time";

type EvalStatus = CertificateEvaluation["status"];
type EvalState = ActionResult<{ status: EvalStatus; certificateCode: string | null }> | null;
type CertState = ActionResult<{ code: string }> | null;

const STATUS_OPTIONS: { value: EvalStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
];

function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Tooltip label={label} side="right">
        <span className="mt-0.5 text-ink-muted [&>svg]:size-4" aria-label={label}>
          {icon}
        </span>
      </Tooltip>
      <span className="min-w-0 break-words text-ink">{children}</span>
    </li>
  );
}

/** Evaluation modal: learner details on the left; Evaluation / Certification tabs on the right. */
export function EvaluateDialog({ event, open, onClose, canEdit, today }: { event: ScheduleEvent; open: boolean; onClose: () => void; canEdit: boolean; today: string }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"evaluation" | "certification">("evaluation");
  const [rating, setRating] = useState(event.evaluation?.rating ?? 0);
  const [status, setStatus] = useState<EvalStatus>(event.evaluation?.status ?? "pending");
  const [savedStatus, setSavedStatus] = useState<EvalStatus | null>(event.evaluation?.status ?? null);
  const [certificateCode, setCertificateCode] = useState<string | null>(event.certificate?.code ?? null);
  const [meetingLink, setMeetingLink] = useState(event.meetingLink ?? "");
  const [savedLink, setSavedLink] = useState(event.meetingLink ?? "");
  const [linkPending, startLink] = useTransition();

  const [evalState, evalAction, evalPending] = useActionState<EvalState, FormData>(async (prev, formData) => {
    const res = await saveEvaluationAction(prev, formData);
    if (res.ok) {
      toast({ title: res.message ?? "Evaluation saved successfully", tone: "success" });
      setSavedStatus(res.data.status);
      if (res.data.certificateCode) setCertificateCode(res.data.certificateCode);
      if (res.data.status === "pass") setTab("certification");
      else onClose();
    } else {
      toast({ title: res.error, tone: "warning" });
    }
    return res;
  }, null);

  const [certState, certAction, certPending] = useActionState<CertState, FormData>(async (prev, formData) => {
    const res = await saveEvaluationCertificateAction(prev, formData);
    if (res.ok) {
      toast({ title: res.message ?? "Certificate saved successfully", tone: "success" });
      setCertificateCode(res.data.code);
    } else {
      toast({ title: res.error, tone: "error" });
    }
    return res;
  }, null);

  const showCertificationTab = savedStatus === "pass" || !!certificateCode;
  const evalErrors = evalState && !evalState.ok ? evalState.fieldErrors : undefined;
  const certErrors = certState && !certState.ok ? certState.fieldErrors : undefined;

  const saveLink = () =>
    startLink(async () => {
      const res = await updateMeetingLinkAction(event.id, meetingLink);
      if (res.ok) {
        setSavedLink(res.data.meetingLink);
        toast({ title: res.message ?? "Meeting link saved", tone: "success" });
      } else {
        toast({ title: res.error, tone: "error" });
      }
    });

  return (
    <Dialog open={open} onClose={onClose} size="xl" title={`${event.learner.name}'s Evaluation`} description={event.courseTitle}>
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: details */}
        <div className="flex flex-col gap-4">
          <ul className="space-y-2.5">
            <DetailRow icon={<Icon.User />} label="Email ID">
              <a href={`mailto:${event.learner.email}`} className="hover:underline">
                {event.learner.email}
              </a>
            </DetailRow>
            <DetailRow icon={<Icon.BookOpen />} label="Course">
              {event.courseSlug ? (
                <Link href={`/courses/${event.courseSlug}`} className="text-accent hover:underline">
                  {event.courseTitle}
                </Link>
              ) : (
                event.courseTitle
              )}
            </DetailRow>
            {event.batchTitle && (
              <DetailRow icon={<Icon.Users />} label="Batch">
                {event.batchSlug ? (
                  <Link href={`/batches/${event.batchSlug}`} className="text-accent hover:underline">
                    {event.batchTitle}
                  </Link>
                ) : (
                  event.batchTitle
                )}
              </DetailRow>
            )}
            <DetailRow icon={<Icon.Calendar />} label="Date">
              {formatShortDate(event.date)}
            </DetailRow>
            <DetailRow icon={<Icon.Clock />} label="Time">
              {formatClock12(event.startTime)} - {formatClock12(event.endTime)}
            </DetailRow>
            <DetailRow icon={<Icon.Globe />} label="Timezone">
              {event.timezoneLabel}
              <span className="block text-xs text-ink-muted">
                Your time: <LocalDateTime iso={event.startsAt} mode="weekday-datetime" />
              </span>
            </DetailRow>
          </ul>

          {canEdit && (
            <div className="space-y-1.5">
              <label htmlFor={`meet-${event.id}`} className="text-xs font-medium text-ink-muted">
                Meeting link
              </label>
              <div className="flex gap-2">
                <Input id={`meet-${event.id}`} type="url" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://" />
                <Button variant="outline" size="md" onClick={saveLink} loading={linkPending} disabled={meetingLink.trim() === savedLink}>
                  Save
                </Button>
              </div>
              <p className="text-[11px] text-ink-faint">Paste your own video-call link to replace the generated one. The learner is notified, and your next bookings reuse this link.</p>
            </div>
          )}

          <div className="mt-auto">
            {certificateCode ? (
              <ButtonLink href={`/certificates/${certificateCode}`} variant="outline" className="w-full" leftIcon={<Icon.FileText className="size-4" />} target="_blank" rel="noopener noreferrer">
                View Certificate
              </ButtonLink>
            ) : savedLink ? (
              <ButtonLink href={savedLink} className="w-full" leftIcon={<Icon.Video className="size-4" />}>
                Join Meeting
              </ButtonLink>
            ) : null}
          </div>
        </div>

        {/* Right: tabs */}
        <div className="min-w-0 border-t border-border pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <SegmentedControl
            size="md"
            value={tab}
            onChange={setTab}
            options={[
              { value: "evaluation", label: "Evaluation", icon: <Icon.ClipboardList className="size-4" /> },
              ...(showCertificationTab ? [{ value: "certification" as const, label: "Certification", icon: <Icon.GraduationCap className="size-4" /> }] : []),
            ]}
          />

          {tab === "evaluation" || !showCertificationTab ? (
            <form onSubmit={submitWithoutReset(evalAction)} className="mt-4 space-y-4">
              <input type="hidden" name="requestId" value={event.id} />
              <FormError message={evalState && !evalState.ok && !evalState.fieldErrors ? evalState.error : null} />
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink">Rating</p>
                  <StarRatingInput name="rating" value={rating} onChange={setRating} disabled={!canEdit} />
                  {evalErrors?.rating && <p className="mt-1 text-xs text-danger">{evalErrors.rating}</p>}
                </div>
                <div className="w-full sm:w-44">
                  <Field label="Status" htmlFor={`status-${event.id}`} error={evalErrors?.status}>
                    <Select id={`status-${event.id}`} name="status" value={status} onChange={(e) => setStatus(e.target.value as EvalStatus)} options={STATUS_OPTIONS} disabled={!canEdit} />
                  </Field>
                </div>
              </div>
              <Field label="Summary" htmlFor={`summary-${event.id}`} error={evalErrors?.summary} hint={status === "pass" ? "Passing issues the certificate automatically." : undefined}>
                <Textarea
                  id={`summary-${event.id}`}
                  name="summary"
                  rows={7}
                  defaultValue={event.evaluation?.summary ?? ""}
                  placeholder="Strengths, gaps and next steps for the learner."
                  disabled={!canEdit}
                  invalid={!!evalErrors?.summary}
                />
              </Field>
              {canEdit ? (
                <div className="flex justify-end">
                  <Button type="submit" loading={evalPending} leftIcon={<Icon.Check className="size-4" />}>
                    Save
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-ink-muted">Only the assigned evaluator can record this evaluation.</p>
              )}
            </form>
          ) : (
            <form onSubmit={submitWithoutReset(certAction)} className="mt-4 space-y-4">
              <input type="hidden" name="requestId" value={event.id} />
              <FormError message={certState && !certState.ok && !certState.fieldErrors ? certState.error : null} />
              <Switch
                id={`published-${event.id}`}
                name="published"
                defaultChecked={event.certificate?.published ?? true}
                disabled={!canEdit}
                label="Published"
                description="Make this certificate visible to the participant."
              />
              <CertificateTemplateField id={`template-${event.id}`} defaultValue={event.certificate?.templateId} disabled={!canEdit} error={certErrors?.templateId} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Issue Date" htmlFor={`issue-${event.id}`} error={certErrors?.issueDate}>
                  <Input id={`issue-${event.id}`} type="date" name="issueDate" defaultValue={event.certificate?.issueDate ?? today} disabled={!canEdit} />
                </Field>
                <Field label="Expiry Date" htmlFor={`expiry-${event.id}`} error={certErrors?.expiryDate} hint="Optional.">
                  <Input id={`expiry-${event.id}`} type="date" name="expiryDate" defaultValue={event.certificate?.expiryDate ?? ""} disabled={!canEdit} />
                </Field>
              </div>
              {canEdit && (
                <div className="flex justify-end">
                  <Button type="submit" loading={certPending} leftIcon={<Icon.Certificate className="size-4" />}>
                    Save
                  </Button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </Dialog>
  );
}

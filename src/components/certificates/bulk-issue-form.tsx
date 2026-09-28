"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import type { BulkRoster } from "@/lib/data/certificates";
import { bulkIssueCertificatesAction, type BulkIssueResult } from "@/lib/actions/certificates";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormError, Input, Select, Switch } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

type BulkState = ActionResult<BulkIssueResult> | null;

export function BulkIssueForm({ roster, evaluators, today }: { roster: BulkRoster; evaluators: { value: string; label: string }[]; today: string }) {
  const { toast } = useToast();
  const [courseId, setCourseId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [state, formAction, pending] = useActionState<BulkState, FormData>(async (prev, formData) => {
    const res = await bulkIssueCertificatesAction(prev, formData);
    if (res.ok) {
      toast({ title: res.message ?? "Certificates generated", tone: res.data.skipped.length ? "warning" : "success" });
      setPicked(new Set());
    } else {
      toast({ title: res.error || "Unable to generate certificate", tone: "error" });
    }
    return res;
  }, null);

  const certified = (s: BulkRoster["students"][number]) => (courseId ? s.certifiedCourseIds.includes(courseId) : s.certifiedForBatch);
  const progressOf = (s: BulkRoster["students"][number]) => (courseId ? (s.courseProgress[courseId] ?? 0) : s.averageProgress);
  const eligible = roster.students.filter((s) => !certified(s));
  const selected = eligible.filter((s) => picked.has(s.user.id));
  const allSelected = eligible.length > 0 && selected.length === eligible.length;
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="batchId" value={roster.batch.id} />
      {selected.map((s) => (
        <input key={s.user.id} type="hidden" name="userIds" value={s.user.id} />
      ))}
      <FormError message={state && !state.ok ? state.error : null} />

      {state?.ok && (
        <div role="status" className="space-y-2 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
          <p className="font-medium text-ink">
            {state.data.issued.length} generated · {state.data.skipped.length} skipped
          </p>
          {state.data.issued.length > 0 && (
            <p className="text-ink-muted">
              Issued:{" "}
              {state.data.issued.map((i, idx) => (
                <span key={i.code}>
                  {idx > 0 && ", "}
                  <a href={`/certificates/${i.code}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {i.name}
                  </a>
                </span>
              ))}
            </p>
          )}
          <ul className="list-inside list-disc text-ink-muted">
            {state.data.skipped.map((s, i) => (
              <li key={`${s.name}-${i}`}>
                <span className="font-medium text-ink">{s.name}:</span> {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader title="Generate Certificates" description={`Issue certificates to students of ${roster.batch.title}.`} />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Course" htmlFor="bulk-course" error={errors?.courseId} hint="A batch certificate, or a certificate for one of the batch's courses.">
            <Select id="bulk-course" name="courseId" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Whole batch ({roster.batch.title})</option>
              {roster.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Evaluator" htmlFor="bulk-evaluator" error={errors?.evaluatorId} hint="Optional.">
            <Select id="bulk-evaluator" name="evaluatorId" defaultValue="">
              <option value="">No evaluator</option>
              {evaluators.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Issue Date" htmlFor="bulk-issue" required error={errors?.issueDate}>
            <Input id="bulk-issue" type="date" name="issueDate" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} invalid={!!errors?.issueDate} />
          </Field>
          <Field label="Expiry Date" htmlFor="bulk-expiry" error={errors?.expiryDate} hint="Optional.">
            <Input id="bulk-expiry" type="date" name="expiryDate" min={issueDate || undefined} invalid={!!errors?.expiryDate} />
          </Field>
          <div className="sm:col-span-2">
            <Switch id="bulk-published" name="published" defaultChecked label="Published" description="Enabling this will publish the certificate on the certified participants page." />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Students (${roster.students.length})`}
          description={courseId ? "Completion is shown for the selected course." : "Completion is the average across the batch's courses."}
          actions={
            eligible.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPicked(new Set(eligible.filter((s) => progressOf(s) >= 100).map((s) => s.user.id)))}
              >
                Select completed only
              </Button>
            ) : undefined
          }
        />
        <div className="p-3 sm:p-4">
          <Table>
            <THead>
              <tr>
                <TH className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all eligible students"
                    checked={allSelected}
                    disabled={eligible.length === 0}
                    onChange={() => setPicked(allSelected ? new Set() : new Set(eligible.map((s) => s.user.id)))}
                    className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                  />
                </TH>
                <TH>Student</TH>
                <TH className="w-40 sm:w-56">Completion</TH>
                <TH className="hidden sm:table-cell">Status</TH>
              </tr>
            </THead>
            <TBody>
              {roster.students.map((s) => {
                const done = certified(s);
                const pct = progressOf(s);
                return (
                  <TR key={s.user.id} className={picked.has(s.user.id) && !done ? "bg-accent/5" : undefined}>
                    <TD className="w-10">
                      <input
                        type="checkbox"
                        aria-label={`Select ${s.user.name}`}
                        checked={!done && picked.has(s.user.id)}
                        disabled={done}
                        onChange={() => toggle(s.user.id)}
                        className="size-4 cursor-pointer rounded border-border-strong accent-accent disabled:cursor-not-allowed"
                      />
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={s.user.name} src={s.user.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{s.user.name}</p>
                          <p className="truncate text-xs text-ink-muted">{s.user.email}</p>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <ProgressBar value={pct} size="sm" tone={pct >= 100 ? "success" : "accent"} showLabel />
                    </TD>
                    <TD className="hidden sm:table-cell">
                      {done ? (
                        <Badge tone="success" dot>
                          Certified
                        </Badge>
                      ) : pct >= 100 ? (
                        <Badge tone="info">Completed</Badge>
                      ) : (
                        <Badge tone="neutral">In progress</Badge>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {errors?.userIds && <p className="mt-2 text-xs text-danger">{errors.userIds}</p>}
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Link href="/admin/certificates" className="inline-flex h-9.5 items-center justify-center rounded-lg px-4 text-sm font-medium text-ink hover:bg-surface-2">
          Cancel
        </Link>
        <Button type="submit" loading={pending} disabled={selected.length === 0} leftIcon={<Icon.Certificate className="size-4" />}>
          Generate certificates{selected.length ? ` (${selected.length})` : ""}
        </Button>
      </div>
    </form>
  );
}

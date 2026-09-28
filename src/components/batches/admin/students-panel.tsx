"use client";

import Link from "next/link";
import { useState } from "react";
import { addBatchStudentsAction, removeBatchStudentAction } from "@/lib/actions/batches";
import { cn, formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useActionForm, useServerAction } from "../hooks";
import type { Option, StudentProgressRow } from "../types";

const SOURCES = ["Manual", "Website", "Referral", "Newsletter", "Social media", "Partner", "Event"];

function AddStudentsForm({ batchId, candidates, seatsLeft, onDone }: { batchId: string; candidates: Option[]; seatsLeft: number | null; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { onSubmit, pending, error, fieldErrors } = useActionForm(addBatchStudentsAction, { onSuccess: onDone });
  const q = query.trim().toLowerCase();
  const filtered = candidates.filter((c) => !q || `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(q)).slice(0, 100);
  const overLimit = seatsLeft !== null && selected.length > seatsLeft;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="batchId" value={batchId} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="userIds" value={id} />
      ))}
      <FormError message={error} />
      <Field label="Student" required error={fieldErrors.userIds} hint={seatsLeft === null ? "Unlimited seats." : `${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left.`}>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users by name or email" leftAddon={<Icon.Search className="size-4" />} aria-label="Search users" autoFocus />
      </Field>
      <ul className="scrollbar-thin max-h-64 overflow-y-auto rounded-lg border border-border" role="listbox" aria-multiselectable="true" aria-label="Users">
        {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-muted">{candidates.length ? "No users match your search." : "Everyone is already enrolled."}</li>}
        {filtered.map((c) => {
          const on = selected.includes(c.value);
          return (
            <li key={c.value} role="option" aria-selected={on}>
              <button type="button" onClick={() => toggle(c.value)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2", on && "bg-accent/5")}>
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>
                  {on && <Icon.Check className="size-3" />}
                </span>
                <Avatar name={c.label} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.label}</span>
                  <span className="block truncate text-xs text-ink-muted">{c.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Field label="Source" htmlFor="enroll-source" hint="How this student found the batch." error={fieldErrors.source}>
        <Input id="enroll-source" name="source" list="enroll-sources" defaultValue="Manual" maxLength={60} />
        <datalist id="enroll-sources">
          {SOURCES.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      {overLimit && <p className="text-xs text-danger">You selected more students than there are seats left.</p>}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-sm text-ink-muted">{selected.length} selected</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={!selected.length || overLimit} leftIcon={<Icon.UserPlus className="size-4" />}>
            Enroll {selected.length > 1 ? `${selected.length} students` : "student"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Enrolled students with source and payment info; add (search users) and remove. */
export function StudentsPanel({
  batchId,
  students,
  candidates,
  seatCount,
}: {
  batchId: string;
  students: StudentProgressRow[];
  candidates: Option[];
  seatCount: number;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<StudentProgressRow | null>(null);
  const { pending, run } = useServerAction();
  const seatsLeft = seatCount > 0 ? Math.max(0, seatCount - students.length) : null;
  const full = seatsLeft !== null && seatsLeft <= 0;
  const q = query.trim().toLowerCase();
  const rows = students.filter((s) => !q || `${s.user.name} ${s.user.email} ${s.source ?? ""}`.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Students</h2>
          <p className="text-sm text-ink-muted">
            {students.length} enrolled{seatCount > 0 ? ` · ${seatsLeft} of ${seatCount} seats left` : " · unlimited seats"}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {students.length > 0 && (
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search students" leftAddon={<Icon.Search className="size-4" />} className="sm:w-56" />
          )}
          <Button onClick={() => setAdding(true)} disabled={full} title={full ? "There are no seats available in this batch." : undefined} leftIcon={<Icon.UserPlus className="size-4" />}>
            Enroll students
          </Button>
        </div>
      </div>

      {students.length === 0 ? (
        <EmptyState
          icon={<Icon.Users />}
          title="No students enrolled yet"
          description="Enroll students to track their progress here. Learners can also enroll themselves when self-enrollment is on."
          action={
            <Button onClick={() => setAdding(true)} leftIcon={<Icon.UserPlus className="size-4" />}>
              Enroll students
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Student</TH>
              <TH>Source</TH>
              <TH>Payment</TH>
              <TH>Enrolled on</TH>
              <TH className="text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && (
              <TableEmpty colSpan={5}>
                <span className="block font-medium text-ink">No students match your search</span>
                Try a different name
              </TableEmpty>
            )}
            {rows.map((s) => (
              <TR key={s.userId}>
                <TD>
                  <span className="flex min-w-48 items-center gap-2.5">
                    <Avatar name={s.user.name} src={s.user.avatarUrl} size="sm" />
                    <span className="min-w-0">
                      <Link href={`/user/${s.user.username}`} className="block truncate font-medium hover:text-accent">
                        {s.user.name}
                      </Link>
                      <span className="block truncate text-xs text-ink-muted">{s.user.email}</span>
                    </span>
                  </span>
                </TD>
                <TD className="text-ink-muted">{s.source || "—"}</TD>
                <TD>{s.paymentId ? <Badge tone="success">Paid</Badge> : <span className="text-ink-faint">—</span>}</TD>
                <TD className="whitespace-nowrap text-ink-muted">{formatDate(s.enrolledAt)}</TD>
                <TD className="text-right">
                  <IconButton label={`Remove ${s.user.name}`} size="icon-sm" onClick={() => setRemoving(s)} className="hover:text-danger">
                    <Icon.Trash className="size-4" />
                  </IconButton>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title="Enroll a Student" description="Enrolled students get access to every course in the batch." size="md">
        {adding && <AddStudentsForm batchId={batchId} candidates={candidates} seatsLeft={seatsLeft} onDone={() => setAdding(false)} />}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) run(() => removeBatchStudentAction(batchId, removing.userId), { onSuccess: () => setRemoving(null) });
        }}
        loading={pending}
        destructive
        title={`Remove ${removing?.user.name ?? "student"} from this batch?`}
        description="They will lose access to the batch's classes, announcements and discussions. Their course enrollments and progress are kept."
        confirmLabel="Remove"
      />
    </div>
  );
}

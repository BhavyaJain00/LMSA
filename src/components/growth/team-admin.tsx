"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { adjustSeatsAction, createTeamAction, deleteTeamAction, saveTeamSettingsAction, setTeamCoursesAction } from "@/lib/actions/teams";
import { MAX_TEAM_COURSES, MAX_TEAM_SEATS, TEAM_NAME_MAX } from "@/lib/growth/teams-shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { SaveBar } from "@/components/admin/settings/save-bar";
import { SettingsSection, SettingsSwitchRow } from "@/components/admin/settings/settings-ui";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { money } from "@/components/commerce/order-summary";
import { pluralize } from "@/lib/utils";

export interface AdminCourseOption {
  id: string;
  title: string;
  price: number;
  currency: string;
  published: boolean;
}

/** Checkbox list of courses with a search box (posts `courseIds`). */
function CoursePicker({ courses, selected, onChange, error }: { courses: AdminCourseOption[]; selected: Set<string>; onChange: (next: Set<string>) => void; error?: string }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle ? courses.filter((c) => c.title.toLowerCase().includes(needle)) : courses;
  const toggle = (courseId: string) => {
    const next = new Set(selected);
    if (next.has(courseId)) next.delete(courseId);
    else if (next.size < MAX_TEAM_COURSES) next.add(courseId);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {courses.length > 8 && (
        <>
          <label htmlFor={`${id}-search`} className="sr-only">
            Search courses
          </label>
          <Input id={`${id}-search`} type="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search courses" leftAddon={<Icon.Search className="size-4" />} />
        </>
      )}
      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-label="Courses">
        {visible.length === 0 && <li className="px-3 py-5 text-center text-sm text-ink-muted">{courses.length ? "No course matches your search." : "There are no courses yet."}</li>}
        {visible.map((course) => (
          <li key={course.id}>
            <label htmlFor={`${id}-${course.id}`} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
              <input id={`${id}-${course.id}`} type="checkbox" checked={selected.has(course.id)} onChange={() => toggle(course.id)} className="size-4 shrink-0 cursor-pointer accent-accent" />
              <span className="min-w-0 flex-1 truncate text-ink">
                {course.title}
                {!course.published && <span className="text-ink-muted"> · unpublished</span>}
              </span>
              <span className="shrink-0 tabular-nums text-ink-muted">{course.price > 0 ? money(course.price, course.currency) : "Free"}</span>
            </label>
          </li>
        ))}
      </ul>
      {[...selected].map((courseId) => (
        <input key={courseId} type="hidden" name="courseIds" value={courseId} />
      ))}
      <p className={error ? "text-xs text-danger" : "text-xs text-ink-muted"}>{error ?? `${selected.size} selected (up to ${MAX_TEAM_COURSES}).`}</p>
    </div>
  );
}

/** Set a team's seat count by hand (invoices, corrections). */
export function AdjustSeatsForm({ orgId, seatCount, used }: { orgId: string; seatCount: number; used: number }) {
  const id = useId();
  const { onSubmit, pending, errors, formError, dirty, markDirty } = useFormAction(adjustSeatsAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <Field label="Seats" htmlFor={`${id}-seats`} error={errors.seatCount}>
          <Input id={`${id}-seats`} name="seatCount" type="number" inputMode="numeric" min={used} max={MAX_TEAM_SEATS} step={1} defaultValue={seatCount} invalid={!!errors.seatCount} className="tabular-nums" />
        </Field>
        <Field label="Reason (kept in the audit log)" htmlFor={`${id}-note`}>
          <Input id={`${id}-note`} name="note" maxLength={200} placeholder="Invoice 2026-014 paid by bank transfer" />
        </Field>
      </div>
      <p className="text-xs text-ink-muted">
        {pluralize(used, "seat")} in use. The count can&apos;t go below that; revoke seats first. The team&apos;s managers are notified of the change.
      </p>
      {formError && !errors.seatCount && <FormError message={formError} />}
      <Button type="submit" loading={pending} disabled={!dirty}>
        Save seat count
      </Button>
    </form>
  );
}

/** Choose which courses a team's seats unlock. */
export function TeamCoursesForm({ orgId, courseIds, courses }: { orgId: string; courseIds: string[]; courses: AdminCourseOption[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(courseIds));
  const [dirty, setDirty] = useState(false);
  const { onSubmit, pending, errors, formError } = useFormAction(setTeamCoursesAction, { onSuccess: () => setDirty(false) });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <CoursePicker
        courses={courses}
        selected={selected}
        onChange={(next) => {
          setSelected(next);
          setDirty(true);
        }}
        error={errors.courseIds}
      />
      <p className="text-xs text-ink-muted">Members are enrolled in courses you add. Courses you remove stay with members who already joined them, and new orders are priced from the courses listed here.</p>
      {formError && !errors.courseIds && <FormError message={formError} />}
      <Button type="submit" loading={pending} disabled={!dirty || selected.size === 0}>
        Save courses
      </Button>
    </form>
  );
}

/** "New team" for invoiced or sponsored teams: no online order needed. */
export function CreateTeamButton({ courses }: { courses: AdminCourseOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} leftIcon={<Icon.Plus className="size-4" />}>
        New team
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New team" description="For teams that pay by invoice or are sponsored. The owner invites the members.">
        {open && <CreateTeamForm courses={courses} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function CreateTeamForm({ courses, onClose }: { courses: AdminCourseOption[]; onClose: () => void }) {
  const id = useId();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { onSubmit, pending, errors, formError } = useFormAction(createTeamAction, {
    onSuccess: (result) => {
      onClose();
      router.push(`/admin/teams/${result.data.id}`);
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field label="Company or team name" htmlFor={`${id}-name`} required error={errors.name}>
        <Input id={`${id}-name`} name="name" maxLength={TEAM_NAME_MAX} invalid={!!errors.name} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Owner's account email" htmlFor={`${id}-owner`} required error={errors.ownerEmail} hint="They manage the team and must already have an account.">
          <Input id={`${id}-owner`} name="ownerEmail" type="email" maxLength={200} invalid={!!errors.ownerEmail} autoComplete="off" required />
        </Field>
        <Field label="Seats" htmlFor={`${id}-seats`} required error={errors.seatCount}>
          <Input id={`${id}-seats`} name="seatCount" type="number" inputMode="numeric" min={0} max={MAX_TEAM_SEATS} step={1} defaultValue={5} invalid={!!errors.seatCount} className="tabular-nums" required />
        </Field>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Courses for every seat</p>
        <CoursePicker courses={courses} selected={selected} onChange={setSelected} error={errors.courseIds} />
      </div>
      <FormError message={formError && !Object.keys(errors).length ? formError : null} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Create team
        </Button>
      </div>
    </form>
  );
}

export function DeleteTeamButton({ orgId, name, inUse }: { orgId: string; name: string; inUse: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)} leftIcon={<Icon.Trash className="size-4" />}>
        Delete team
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteTeamAction(orgId);
            // A successful delete redirects to the list; only failures come back here.
            if (result && !result.ok) {
              toast.error(result.error);
              setOpen(false);
            }
          })
        }
        loading={busy}
        destructive
        title={`Delete ${name}?`}
        description={
          inUse > 0
            ? `${pluralize(inUse, "seat")} in use ${inUse === 1 ? "is" : "are"} revoked: members lose access to the team's courses they haven't finished. Orders stay in Transactions. This can't be undone.`
            : "The team and its seat history are removed. Orders stay in Transactions. This can't be undone."
        }
        confirmLabel="Delete team"
      />
    </>
  );
}

/** Switch team purchases on or off for the whole site. */
export function TeamProgramSettingsForm({ enabled }: { enabled: boolean }) {
  const { onSubmit, pending, dirty, markDirty, state } = useFormAction(saveTeamSettingsAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate>
      <input type="hidden" name="section" value="teams" />
      <SettingsSection title="Team purchases" description="Companies buy seats for their people and manage them from the My team page.">
        <SettingsSwitchRow>
          <Switch
            name="teamsEnabled"
            defaultChecked={enabled}
            label="Sell team seats"
            description="Shows the “For teams” purchase page. Turning it off stops new purchases; existing teams keep their seats and keep working."
          />
        </SettingsSwitchRow>
      </SettingsSection>
      <SaveBar dirty={dirty} pending={pending} saved={state?.ok} failed={state?.ok === false} />
    </form>
  );
}

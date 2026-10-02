"use client";

import { useState } from "react";
import type { LiveClass } from "@/lib/types";
import { deleteLiveClassAction, saveAttendanceAction, saveLiveClassAction, saveRecordingAction } from "@/lib/actions/live-classes";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { FileUpload } from "@/components/ui/file-upload";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useActionForm, useNow, useServerAction } from "../hooks";
import { LocalInstant } from "../local-time";
import { JOIN_WINDOW_MINUTES, addMinutesToClock, formatClockRange, formatCountdown, formatDayKey, formatGmtOffset, joinWindowState } from "../tz";
import type { LiveClassView, Option } from "../types";
import { TimezoneSelect } from "./form-fields";

export interface LiveClassBatchInfo {
  id: string;
  slug: string;
  timezone: string;
  startDate: string;
  endDate: string;
  startTime: string;
  conferencingProvider?: LiveClass["provider"];
  instructorIds: string[];
}

export interface StudentLite {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

const providerLabel: Record<LiveClass["provider"], string> = { zoom: "Zoom", google_meet: "Google Meet", custom: "Custom link" };
const providerPlaceholder: Record<LiveClass["provider"], string> = {
  zoom: "https://us02web.zoom.us/j/1234567890",
  google_meet: "https://meet.google.com/abc-defg-hij",
  custom: "https://meet.example.com/my-class",
};

function LiveClassForm({
  batch,
  hosts,
  initial,
  defaultHostId,
  defaultDate,
  onDone,
}: {
  batch: LiveClassBatchInfo;
  hosts: Option[];
  initial: LiveClassView | null;
  defaultHostId: string;
  defaultDate: string;
  onDone: () => void;
}) {
  const [provider, setProvider] = useState<LiveClass["provider"]>(initial?.provider ?? batch.conferencingProvider ?? "custom");
  const [timezone, setTimezone] = useState(initial?.timezone ?? batch.timezone);
  const [time, setTime] = useState(initial?.time ?? batch.startTime ?? "18:00");
  const [duration, setDuration] = useState(String(initial?.durationMinutes ?? 60));
  const { onSubmit, pending, error, fieldErrors } = useActionForm(saveLiveClassAction, { onSuccess: onDone });
  const endPreview = /^\d{2}:\d{2}$/.test(time) && Number(duration) > 0 ? addMinutesToClock(time, Number(duration)) : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="batchId" value={batch.id} />
      {initial && <input type="hidden" name="classId" value={initial.id} />}
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="lc-title" required error={fieldErrors.title} className="sm:col-span-2">
          <Input id="lc-title" name="title" defaultValue={initial?.title} required maxLength={140} invalid={!!fieldErrors.title} placeholder="e.g. Week 2: Async JavaScript" autoFocus />
        </Field>
        <Field label="Date" htmlFor="lc-date" required error={fieldErrors.date}>
          <Input id="lc-date" name="date" type="date" defaultValue={initial?.date ?? defaultDate} required invalid={!!fieldErrors.date} />
        </Field>
        <Field label="Time" htmlFor="lc-time" required error={fieldErrors.time} hint="24 hour format (HH:mm), in the class timezone.">
          <Input id="lc-time" name="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required invalid={!!fieldErrors.time} />
        </Field>
        <Field label="Duration (in minutes)" htmlFor="lc-duration" required error={fieldErrors.durationMinutes} hint={endPreview ? `Ends at ${endPreview}` : undefined}>
          <Input id="lc-duration" name="durationMinutes" type="number" min={5} max={720} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} required invalid={!!fieldErrors.durationMinutes} />
        </Field>
        <Field label="Timezone" htmlFor="lc-timezone" required error={fieldErrors.timezone}>
          <TimezoneSelect id="lc-timezone" name="timezone" value={timezone} onChange={setTimezone} invalid={!!fieldErrors.timezone} />
        </Field>
        <Field label="Host" htmlFor="lc-host" required error={fieldErrors.hostId}>
          <Select id="lc-host" name="hostId" defaultValue={initial?.hostId ?? defaultHostId} invalid={!!fieldErrors.hostId}>
            {hosts.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Conferencing provider" htmlFor="lc-provider" required error={fieldErrors.provider}>
          <Select id="lc-provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value as LiveClass["provider"])}>
            <option value="custom">Custom link</option>
            <option value="zoom">Zoom</option>
            <option value="google_meet">Google Meet</option>
          </Select>
        </Field>
        <Field
          label="Join URL"
          htmlFor="lc-join"
          required
          error={fieldErrors.joinUrl}
          hint={provider === "custom" ? "Any video call link learners can open in the browser." : `Paste the ${providerLabel[provider]} meeting link.`}
          className="sm:col-span-2"
        >
          <Input id="lc-join" name="joinUrl" type="url" defaultValue={initial?.joinUrl} placeholder={providerPlaceholder[provider]} required invalid={!!fieldErrors.joinUrl} />
        </Field>
        <Field label="Host start URL" htmlFor="lc-start" error={fieldErrors.startUrl} hint="Optional link only hosts see (e.g. Zoom start link)." className="sm:col-span-2">
          <Input id="lc-start" name="startUrl" type="url" defaultValue={initial?.startUrl} invalid={!!fieldErrors.startUrl} />
        </Field>
        <Field label="Meeting ID" htmlFor="lc-meeting" error={fieldErrors.meetingId}>
          <Input id="lc-meeting" name="meetingId" defaultValue={initial?.meetingId} maxLength={80} />
        </Field>
        <Field label="Passcode" htmlFor="lc-password" error={fieldErrors.password}>
          <Input id="lc-password" name="password" defaultValue={initial?.password} maxLength={80} autoComplete="off" />
        </Field>
        <Field label="Auto Recording" htmlFor="lc-recording">
          <Select id="lc-recording" name="autoRecording" defaultValue={initial?.autoRecording ?? "none"}>
            <option value="none">No Recording</option>
            <option value="local">Local</option>
            <option value="cloud">Cloud</option>
          </Select>
        </Field>
        {!initial && (
          <div className="flex items-end pb-2">
            <Checkbox name="addToTimetable" defaultChecked label="Add to timetable" description="Show this class on the batch timetable." />
          </div>
        )}
        <Field label="Description" htmlFor="lc-description" error={fieldErrors.description} className="sm:col-span-2">
          <Textarea id="lc-description" name="description" rows={3} defaultValue={initial?.description} maxLength={2000} placeholder="What will you cover? Anything to prepare?" />
        </Field>
      </div>
      {!initial && <p className="text-xs text-ink-muted">Enrolled students are notified when you schedule a class.</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {initial ? "Save changes" : "Schedule class"}
        </Button>
      </div>
    </form>
  );
}

function AttendanceForm({ liveClass, students, onDone }: { liveClass: LiveClassView; students: StudentLite[]; onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>(liveClass.attendeeIds.filter((id) => students.some((s) => s.id === id)));
  const { pending, run } = useServerAction();
  const all = students.length > 0 && selected.length === students.length;
  if (!students.length) return <p className="text-sm text-ink-muted">No students are enrolled in this batch yet.</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-ink-muted">
          {selected.length} of {students.length} present
        </span>
        <Button size="xs" variant="ghost" onClick={() => setSelected(all ? [] : students.map((s) => s.id))}>
          {all ? "Clear all" : "Mark all present"}
        </Button>
      </div>
      <ul className="scrollbar-thin max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {students.map((s) => {
          const on = selected.includes(s.id);
          return (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setSelected((list) => (on ? list.filter((x) => x !== s.id) : [...list, s.id]))}
                  className="size-4 accent-accent"
                />
                <Avatar name={s.name} src={s.avatarUrl} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                  <span className="block truncate text-xs text-ink-muted">{s.email}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button loading={pending} onClick={() => run(() => saveAttendanceAction(liveClass.id, selected), { onSuccess: onDone })}>
          Save attendance
        </Button>
      </div>
    </div>
  );
}

function RecordingForm({ liveClass, onDone }: { liveClass: LiveClassView; onDone: () => void }) {
  const [url, setUrl] = useState(liveClass.recordingUrl ?? "");
  const { pending, run } = useServerAction();
  return (
    <div className="space-y-4">
      <FileUpload kind="video" label="Upload recording" value={url} onChange={(u) => setUrl(u)} hint="MP4 or WebM. Learners watch it in the built-in player." />
      <Field label="…or paste a direct video URL" htmlFor="rec-url" hint="A link to an .mp4/.webm file. YouTube and Vimeo pages are not supported.">
        <Input id="rec-url" type="url" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://cdn.example.com/recordings/class.mp4" />
      </Field>
      <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
        {liveClass.recordingUrl ? (
          <Button variant="ghost" className="text-danger" disabled={pending} onClick={() => run(() => saveRecordingAction(liveClass.id, ""), { onSuccess: onDone })}>
            Remove recording
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button loading={pending} disabled={!url} onClick={() => run(() => saveRecordingAction(liveClass.id, url), { onSuccess: onDone })}>
            Save recording
          </Button>
        </div>
      </div>
    </div>
  );
}

type DialogState = { kind: "form"; item: LiveClassView | null } | { kind: "attendance"; item: LiveClassView } | { kind: "recording"; item: LiveClassView } | { kind: "delete"; item: LiveClassView } | null;

/** Schedule, edit and delete live classes; record attendance and recordings. */
export function LiveClassesPanel({
  batch,
  classes,
  hosts,
  students,
  currentUserId,
  serverNow,
  todayKey,
}: {
  batch: LiveClassBatchInfo;
  classes: LiveClassView[];
  hosts: Option[];
  students: StudentLite[];
  currentUserId: string;
  serverNow: number;
  todayKey: string;
}) {
  const now = useNow(serverNow);
  const [dialog, setDialog] = useState<DialogState>(null);
  const remove = useServerAction();
  const close = () => setDialog(null);
  const defaultHostId = hosts.some((h) => h.value === currentUserId) ? currentUserId : (batch.instructorIds[0] ?? hosts[0]?.value ?? "");
  const defaultDate = todayKey >= batch.startDate && todayKey <= batch.endDate ? todayKey : batch.startDate;
  const margin = JOIN_WINDOW_MINUTES * 60000;
  const upcoming = classes.filter((c) => c.endsAt + margin >= now);
  const past = classes.filter((c) => c.endsAt + margin < now).reverse();

  const renderRow = (c: LiveClassView) => {
    const state = joinWindowState(c.startsAt, c.endsAt, now);
    const attendees = c.attendeeIds.length;
    return (
      <li key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{c.title}</span>
            <Badge tone="outline" size="xs">
              {providerLabel[c.provider]}
            </Badge>
            {state === "ended" ? (
              <Badge tone="neutral" size="xs">
                Ended
              </Badge>
            ) : now >= c.startsAt && now <= c.endsAt ? (
              <Badge tone="danger" size="xs" dot>
                Live now
              </Badge>
            ) : now > c.endsAt ? (
              <Badge tone="warning" size="xs">
                Just ended
              </Badge>
            ) : (
              <Badge tone="info" size="xs">
                in {formatCountdown(c.startsAt - now)}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {formatDayKey(c.date, "weekday")} · {formatClockRange(c.time, c.endTime)}{" "}
            <span className="text-ink-faint">
              ({c.timezone.replace(/_/g, " ")}, {formatGmtOffset(c.timezone, c.startsAt)})
            </span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            {c.host && <span>Host: {c.host.name}</span>}
            <span>{c.durationMinutes} min</span>
            {state === "ended" && (
              <span>
                {attendees}/{students.length} attended
              </span>
            )}
            {c.recordingUrl ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Icon.Video className="size-3.5" /> Recording added
              </span>
            ) : state === "ended" ? (
              <span className="text-warning">No recording yet</span>
            ) : null}
            <LocalInstant at={c.startsAt} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state !== "ended" && (
            <a
              href={c.startUrl || c.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
                state === "open" || state === "closed" ? "bg-accent text-accent-fg hover:brightness-110" : "border border-border-strong text-ink hover:bg-surface-2",
              )}
            >
              <Icon.Monitor className="size-4" /> Start
            </a>
          )}
          {state === "ended" && (
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "recording", item: c })} leftIcon={<Icon.Upload className="size-4" />}>
              {c.recordingUrl ? "Recording" : "Add recording"}
            </Button>
          )}
          <Dropdown
            trigger={
              <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                <Icon.MoreVertical className="size-4" />
                <span className="sr-only">Actions for {c.title}</span>
              </span>
            }
            items={[
              { label: "Edit", icon: <Icon.Edit />, onClick: () => setDialog({ kind: "form", item: c }) },
              { label: "Attendance", icon: <Icon.ListChecks />, onClick: () => setDialog({ kind: "attendance", item: c }), description: `${attendees} marked present` },
              { label: c.recordingUrl ? "Replace recording" : "Add recording", icon: <Icon.Video />, onClick: () => setDialog({ kind: "recording", item: c }) },
              { label: "Copy join link", icon: <Icon.Copy />, onClick: () => void navigator.clipboard?.writeText(c.joinUrl) },
              { label: "Delete", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => setDialog({ kind: "delete", item: c }) },
            ]}
          />
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Live classes</h2>
          <p className="text-sm text-ink-muted">Learners can join from {JOIN_WINDOW_MINUTES} minutes before a class starts until {JOIN_WINDOW_MINUTES} minutes after it starts.</p>
        </div>
        <Button onClick={() => setDialog({ kind: "form", item: null })} leftIcon={<Icon.Plus className="size-4" />}>
          Schedule live class
        </Button>
      </div>

      {!batch.conferencingProvider && (
        <div className="flex items-start gap-3 rounded-card border border-warning/30 bg-warning/10 p-4 text-sm">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-ink">No conferencing provider</p>
            <p className="text-ink-muted">Pick Zoom, Google Meet or a custom provider in Settings to prefill new classes. You can still paste any meeting link per class.</p>
          </div>
        </div>
      )}

      {classes.length === 0 ? (
        <EmptyState
          icon={<Icon.Video />}
          title="No live classes scheduled"
          description="Schedule the first session. Students are notified and can join from the batch page."
          action={
            <Button onClick={() => setDialog({ kind: "form", item: null })} leftIcon={<Icon.Plus className="size-4" />}>
              Schedule live class
            </Button>
          }
        />
      ) : (
        <>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">Upcoming ({upcoming.length})</h3>
            {upcoming.length ? (
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">{upcoming.map(renderRow)}</ul>
            ) : (
              <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-sm text-ink-muted">No upcoming classes.</p>
            )}
          </section>
          {past.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink">Past ({past.length})</h3>
              <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">{past.map(renderRow)}</ul>
            </section>
          )}
        </>
      )}

      <Dialog open={dialog?.kind === "form"} onClose={close} title={dialog?.kind === "form" && dialog.item ? "Edit Live Class" : "Create a Live Class"} size="lg">
        {dialog?.kind === "form" && <LiveClassForm batch={batch} hosts={hosts} initial={dialog.item} defaultHostId={defaultHostId} defaultDate={defaultDate} onDone={close} />}
      </Dialog>
      <Dialog open={dialog?.kind === "attendance"} onClose={close} title={dialog?.kind === "attendance" ? `Attendance for Class - ${dialog.item.title}` : undefined} size="md">
        {dialog?.kind === "attendance" && <AttendanceForm liveClass={dialog.item} students={students} onDone={close} />}
      </Dialog>
      <Dialog open={dialog?.kind === "recording"} onClose={close} title={dialog?.kind === "recording" ? `Recording: ${dialog.item.title}` : undefined} size="md">
        {dialog?.kind === "recording" && <RecordingForm liveClass={dialog.item} onDone={close} />}
      </Dialog>
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        onConfirm={() => {
          if (dialog?.kind === "delete") remove.run(() => deleteLiveClassAction(dialog.item.id), { onSuccess: close });
        }}
        loading={remove.pending}
        destructive
        title={dialog?.kind === "delete" ? `Delete "${dialog.item.title}"?` : "Delete live class?"}
        description="The class, its attendance and recording link are removed, and it disappears from the timetable. This cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}

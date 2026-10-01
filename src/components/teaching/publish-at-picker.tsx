"use client";

import { Field, Input } from "@/components/ui/input";
import { LocalDateTime, useIsClient, useNow } from "@/components/assessments/client-time";
import { SCHEDULE_LIMITS, describeTimeUntil, fromLocalInputValue, toLocalInputValue, type CoursePublishState } from "@/lib/teaching/schedule-shared";
import { publishStateLabel } from "@/lib/teaching/schedule-shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Date and time picker for a publish time. Authors pick in their own time
 * zone (a native `datetime-local` field); the value sent to the server is
 * the UTC instant (`toIso`).
 */

const HOUR = 3_600_000;

/** Quick choices: tomorrow at 9:00 and one week from now at the same time of day (local time). */
function presets(now: number): { label: string; value: string }[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const week = new Date(now + 7 * 24 * HOUR);
  week.setMinutes(0, 0, 0);
  return [
    { label: "Tomorrow, 9:00", value: toLocalInputValue(tomorrow.getTime()) },
    { label: "In one week", value: toLocalInputValue(week.getTime()) },
  ];
}

/** The ISO instant of a picker value, or null when it is empty or invalid. */
export function pickerToIso(value: string): string | null {
  const ms = fromLocalInputValue(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/** Picker value showing an ISO instant in the viewer's time zone ("" when none). */
export function isoToPicker(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? toLocalInputValue(ms) : "";
}

export function PublishAtPicker({
  id,
  value,
  onChange,
  error,
  label = "Publish on",
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  label?: string;
  disabled?: boolean;
}) {
  const client = useIsClient();
  const now = useNow(60_000, 0);
  const zone = client ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const picked = fromLocalInputValue(value);
  const hint = picked !== null && now > 0 ? `Goes live ${describeTimeUntil(picked, now)}${zone ? ` · times are in your time zone (${zone})` : ""}` : zone ? `Times are in your time zone (${zone}).` : "Times are in your time zone.";
  return (
    <div className="space-y-2">
      <Field label={label} htmlFor={id} error={error ?? undefined} hint={hint}>
        <Input
          id={id}
          type="datetime-local"
          value={value}
          min={client && now > 0 ? toLocalInputValue(now + SCHEDULE_LIMITS.minLeadMs) : undefined}
          max={client && now > 0 ? toLocalInputValue(now + SCHEDULE_LIMITS.maxAheadMs) : undefined}
          onChange={(e) => onChange(e.target.value)}
          invalid={!!error}
          disabled={disabled}
          className="max-w-xs"
        />
      </Field>
      {client && now > 0 && !disabled && (
        <div className="flex flex-wrap gap-2" aria-label="Quick choices">
          {presets(now).map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent",
                value === preset.value ? "border-accent bg-accent/10 text-accent" : "border-border text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STATE_TONES: Record<CoursePublishState, BadgeTone> = {
  live: "success",
  scheduled: "info",
  due: "info",
  held: "warning",
  draft: "neutral",
};

/**
 * "Scheduled · Oct 3, 9:00 AM" marker for course and lesson lists. Renders
 * nothing without a publish time (or once the course is published).
 */
export function ScheduleBadge({ publishAt, state = "scheduled", className }: { publishAt?: string | null; state?: CoursePublishState; className?: string }) {
  if (!publishAt || state === "live" || state === "draft") return null;
  return (
    <Badge tone={STATE_TONES[state]} className={className}>
      <Icon.Calendar className="size-3" />
      {state === "held" ? "On hold" : state === "due" ? publishStateLabel(state) : "Scheduled for"}
      {state !== "due" && <LocalDateTime iso={publishAt} />}
    </Badge>
  );
}

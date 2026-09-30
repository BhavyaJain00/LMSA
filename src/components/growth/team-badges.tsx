import { PROGRESS_STATE_LABELS, SEAT_STATE_LABELS, type CourseProgressState, type SeatState, type SeatUsage } from "@/lib/growth/teams-shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn, pluralize } from "@/lib/utils";

/** Shared presentational pieces of the team pages (server and client safe). */

const SEAT_TONES: Record<SeatState, BadgeTone> = { active: "success", invited: "info", expired: "warning", revoked: "neutral" };

export function SeatStateBadge({ state }: { state: SeatState }) {
  return (
    <Badge tone={SEAT_TONES[state]} dot>
      {SEAT_STATE_LABELS[state]}
    </Badge>
  );
}

const PROGRESS_TONES: Record<CourseProgressState, BadgeTone> = { not_started: "neutral", in_progress: "info", completed: "success" };

export function ProgressStateBadge({ state }: { state: CourseProgressState }) {
  return (
    <Badge tone={PROGRESS_TONES[state]} size="xs">
      {PROGRESS_STATE_LABELS[state]}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: "owner" | "manager" | null }) {
  if (!role) return null;
  return (
    <Badge tone={role === "owner" ? "accent" : "outline"} size="xs">
      {role === "owner" ? "Owner" : "Manager"}
    </Badge>
  );
}

/** Seats in use against the team's seat count: members, open invitations and what is left. */
export function SeatMeter({ usage, className }: { usage: SeatUsage; className?: string }) {
  const scale = Math.max(usage.total, usage.used, 1);
  const activeWidth = (usage.active / scale) * 100;
  const invitedWidth = (usage.invited / scale) * 100;
  return (
    <div className={cn("w-full", className)}>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={`${usage.used} of ${pluralize(usage.total, "seat")} in use: ${usage.active} active, ${usage.invited} invited, ${usage.available} free`}
      >
        <div className="h-full bg-success transition-[width] duration-500" style={{ width: `${activeWidth}%` }} />
        <div className="h-full bg-info transition-[width] duration-500" style={{ width: `${invitedWidth}%` }} />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
          {usage.active} active
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-info" aria-hidden="true" />
          {usage.invited} invited
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-surface-3 ring-1 ring-border-strong" aria-hidden="true" />
          {usage.available} free
        </li>
        {usage.over > 0 && <li className="font-medium text-danger">{usage.over} over the limit</li>}
      </ul>
    </div>
  );
}

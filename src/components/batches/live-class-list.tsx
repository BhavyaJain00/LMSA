"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { VideoPlayer } from "@/components/player";
import { useNow } from "./hooks";
import { LocalInstant } from "./local-time";
import { JOIN_WINDOW_MINUTES, formatClockRange, formatCountdown, formatDayKey, formatGmtOffset, joinWindowState } from "./tz";
import type { LiveClassView } from "./types";

const providerLabel: Record<LiveClassView["provider"], string> = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  custom: "Video call",
};

function ExternalButton({ href, children, icon, variant = "primary" }: { href: string; children: ReactNode; icon: ReactNode; variant?: "primary" | "outline" }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-[filter,background-color]",
        variant === "primary" ? "bg-accent text-accent-fg hover:brightness-110" : "border border-border-strong bg-surface-1 text-ink hover:bg-surface-2",
      )}
    >
      {icon}
      {children}
    </a>
  );
}

function ClassCard({
  item,
  now,
  isManager,
  canJoin,
  onWatch,
}: {
  item: LiveClassView;
  now: number;
  isManager: boolean;
  canJoin: boolean;
  onWatch: (item: LiveClassView) => void;
}) {
  const state = joinWindowState(item.startsAt, item.endsAt, now);
  const live = now >= item.startsAt && now <= item.endsAt;
  const ended = state === "ended";

  return (
    <article id={`class-${item.id}`} className="flex scroll-mt-24 flex-col rounded-card border border-border bg-surface-1 p-4 shadow-card transition-colors target:border-accent target:ring-2 target:ring-accent/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{item.title}</h3>
          <p className="mt-0.5 text-xs text-ink-muted">{providerLabel[item.provider]}</p>
        </div>
        {live ? (
          <Badge tone="danger" dot>
            Live now
          </Badge>
        ) : ended ? (
          <Tooltip label="This class has ended">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
              <Icon.Info className="size-3.5" /> Ended
            </span>
          </Tooltip>
        ) : state === "open" ? (
          <Badge tone="warning" dot>
            {now < item.startsAt ? "Starting soon" : "Just ended"}
          </Badge>
        ) : (
          <Badge tone="info">in {formatCountdown(item.startsAt - now)}</Badge>
        )}
      </div>
      {item.description && <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{item.description}</p>}

      <div className="mt-3 space-y-1.5 text-sm text-ink-muted">
        <p className="flex items-center gap-2">
          <Icon.Calendar className="size-4 shrink-0 text-ink-faint" />
          {formatDayKey(item.date, "long")}
        </p>
        <p className="flex items-start gap-2">
          <Icon.Clock className="mt-0.5 size-4 shrink-0 text-ink-faint" />
          <span>
            {formatClockRange(item.time, item.endTime)}{" "}
            <span className="text-ink-faint">
              ({item.timezone.replace(/_/g, " ")}, {formatGmtOffset(item.timezone, item.startsAt)})
            </span>
            <LocalInstant at={item.startsAt} className="block" />
          </span>
        </p>
        {item.host && (
          <p className="flex items-center gap-2">
            <Avatar name={item.host.name} src={item.host.avatarUrl} size="xs" />
            Hosted by {item.host.name}
          </p>
        )}
        {canJoin && !ended && (item.meetingId || item.password) && (
          <p className="flex flex-wrap gap-x-3 text-xs">
            {item.meetingId && (
              <span>
                Meeting ID <span className="font-mono text-ink">{item.meetingId}</span>
              </span>
            )}
            {item.password && (
              <span>
                Passcode <span className="font-mono text-ink">{item.password}</span>
              </span>
            )}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {!ended && canJoin && (
          <>
            {state === "open" ? (
              <ExternalButton href={item.joinUrl} icon={<Icon.Video className="size-4" />}>
                Join
              </ExternalButton>
            ) : (
              <Tooltip label={`Join opens ${JOIN_WINDOW_MINUTES} minutes before the class`}>
                <Button size="sm" disabled leftIcon={<Icon.Video className="size-4" />}>
                  Join
                </Button>
              </Tooltip>
            )}
            {isManager && (
              <ExternalButton href={item.startUrl || item.joinUrl} icon={<Icon.Monitor className="size-4" />} variant="outline">
                Start
              </ExternalButton>
            )}
          </>
        )}
        {ended &&
          (item.recordingUrl ? (
            <Button size="sm" variant="outline" leftIcon={<Icon.Play className="size-3.5" />} onClick={() => onWatch(item)}>
              Watch recording
            </Button>
          ) : (
            <span className="text-xs text-ink-faint">Recording not available</span>
          ))}
        {ended && item.attended && (
          <Badge tone="success" className="ml-auto">
            <Icon.Check className="size-3" /> Attended
          </Badge>
        )}
      </div>
    </article>
  );
}

/**
 * Upcoming classes (with a live countdown and a Join button that opens the
 * meeting in a new tab only within the join window) and past classes with
 * their recordings, played in the custom video player.
 */
export function LiveClassList({
  classes,
  serverNow,
  isManager,
  canJoin,
  emptyAction,
}: {
  classes: LiveClassView[];
  serverNow: number;
  isManager: boolean;
  canJoin: boolean;
  emptyAction?: ReactNode;
}) {
  const now = useNow(serverNow);
  const [watching, setWatching] = useState<LiveClassView | null>(null);
  const margin = JOIN_WINDOW_MINUTES * 60000;
  const upcoming = classes.filter((c) => c.endsAt + margin >= now);
  const past = classes.filter((c) => c.endsAt + margin < now).reverse();

  if (!classes.length) {
    return (
      <EmptyState
        icon={<Icon.Video />}
        title="No live classes scheduled"
        description="Scheduled live sessions for this batch will appear here with a link to join."
        action={emptyAction}
      />
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="upcoming-classes">
        <h2 id="upcoming-classes" className="mb-3 text-base font-semibold text-ink">
          Upcoming <span className="font-normal text-ink-muted">({upcoming.length})</span>
        </h2>
        {upcoming.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((c) => (
              <ClassCard key={c.id} item={c} now={now} isManager={isManager} canJoin={canJoin} onWatch={setWatching} />
            ))}
          </div>
        ) : (
          <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-sm text-ink-muted">No upcoming classes right now.</p>
        )}
      </section>
      {past.length > 0 && (
        <section aria-labelledby="past-classes">
          <h2 id="past-classes" className="mb-3 text-base font-semibold text-ink">
            Past classes <span className="font-normal text-ink-muted">({past.length})</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {past.map((c) => (
              <ClassCard key={c.id} item={c} now={now} isManager={isManager} canJoin={canJoin} onWatch={setWatching} />
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!watching} onClose={() => setWatching(null)} title={watching ? `Recording: ${watching.title}` : undefined} size="xl">
        {watching?.recordingUrl && (
          <div className="space-y-3">
            <VideoPlayer key={watching.id} src={watching.recordingUrl} title={watching.title} />
            <p className="text-xs text-ink-muted">
              Recorded {formatDayKey(watching.date, "long")} · {formatClockRange(watching.time, watching.endTime)} ({watching.timezone.replace(/_/g, " ")})
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

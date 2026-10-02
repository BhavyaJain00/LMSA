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
import { AddToCalendar } from "@/components/pwa/add-to-calendar";
import { useNow } from "./hooks";
import { LocalInstant } from "./local-time";
import { JOIN_WINDOW_MINUTES, formatClockRange, formatCountdown, formatDayKey, formatGmtOffset, joinWindowState } from "./tz";
import type { LiveClassView } from "./types";
import { useLocale, useT } from "@/i18n/client";
import type { Translator } from "@/i18n/translate";
import type { MessageKey } from "@/i18n/catalog";

function providerLabel(provider: LiveClassView["provider"], t: Translator<MessageKey<"public">>): string {
  return provider === "zoom" ? "Zoom" : provider === "google_meet" ? "Google Meet" : t("batches.classes.videoCall");
}

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
  const t = useT("public");
  const locale = useLocale();
  const state = joinWindowState(item.startsAt, item.endsAt, now);
  const live = now >= item.startsAt && now <= item.endsAt;
  const ended = state === "ended";

  return (
    <article id={`class-${item.id}`} className="flex scroll-mt-24 flex-col rounded-card border border-border bg-surface-1 p-4 shadow-card transition-colors target:border-accent target:ring-2 target:ring-accent/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{item.title}</h3>
          <p className="mt-0.5 text-xs text-ink-muted">{providerLabel(item.provider, t)}</p>
        </div>
        {live ? (
          <Badge tone="danger" dot>
            {t("batches.status.active")}
          </Badge>
        ) : ended ? (
          <Tooltip label={t("batches.classes.endedHint")}>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
              <Icon.Info className="size-3.5" /> {t("batches.classes.ended")}
            </span>
          </Tooltip>
        ) : state === "open" && now < item.startsAt ? (
          <Badge tone="warning" dot>
            {t("batches.classes.startingSoon")}
          </Badge>
        ) : now > item.endsAt ? (
          <Badge tone="warning" dot>
            {t("batches.classes.justEnded")}
          </Badge>
        ) : (
          <Badge tone="info">{t("batches.classes.startsIn", { time: formatCountdown(item.startsAt - now, locale) })}</Badge>
        )}
      </div>
      {item.description && <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{item.description}</p>}

      <div className="mt-3 space-y-1.5 text-sm text-ink-muted">
        <p className="flex items-center gap-2">
          <Icon.Calendar className="size-4 shrink-0 text-ink-faint" />
          {formatDayKey(item.date, "long", locale)}
        </p>
        <p className="flex items-start gap-2">
          <Icon.Clock className="mt-0.5 size-4 shrink-0 text-ink-faint" />
          <span>
            {formatClockRange(item.time, item.endTime, locale)}{" "}
            <span className="text-ink-faint">
              ({item.timezone.replace(/_/g, " ")}, {formatGmtOffset(item.timezone, item.startsAt)})
            </span>
            <LocalInstant at={item.startsAt} className="block" />
          </span>
        </p>
        {item.host && (
          <p className="flex items-center gap-2">
            <Avatar name={item.host.name} src={item.host.avatarUrl} size="xs" />
            {t("batches.classes.hostedBy", { name: item.host.name })}
          </p>
        )}
        {canJoin && !ended && (item.meetingId || item.password) && (
          <p className="flex flex-wrap gap-x-3 text-xs">
            {item.meetingId && (
              <span>
                {t.rich("batches.classes.meetingId", { id: item.meetingId, code: (chunks) => <span className="font-mono text-ink" dir="ltr">{chunks}</span> })}
              </span>
            )}
            {item.password && (
              <span>
                {t.rich("batches.classes.passcode", { code: (chunks) => <span className="font-mono text-ink" dir="ltr">{chunks}</span>, passcode: item.password })}
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
                {t("batches.classes.join")}
              </ExternalButton>
            ) : (
              <Tooltip
                label={
                  state === "early"
                    ? t("batches.classes.joinOpens", { minutes: JOIN_WINDOW_MINUTES })
                    : t("batches.classes.joinClosed", { minutes: JOIN_WINDOW_MINUTES })
                }
              >
                <Button size="sm" disabled leftIcon={<Icon.Video className="size-4" />}>
                  {t("batches.classes.join")}
                </Button>
              </Tooltip>
            )}
            {isManager && (
              <ExternalButton href={item.startUrl || item.joinUrl} icon={<Icon.Monitor className="size-4" />} variant="outline">
                {t("batches.classes.start")}
              </ExternalButton>
            )}
          </>
        )}
        {!ended && (canJoin || isManager) && (
          <AddToCalendar
            variant="ghost"
            size="sm"
            align="start"
            event={{
              uid: `live-class-${item.id}`,
              title: item.title,
              description: [
                item.description,
                item.joinUrl ? `Join: ${item.joinUrl}` : "",
                item.meetingId ? `Meeting ID: ${item.meetingId}` : "",
                item.password ? `Passcode: ${item.password}` : "",
                item.host ? `Hosted by ${item.host.name}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              location: item.joinUrl || providerLabel(item.provider, t),
              url: `?tab=classes#class-${item.id}`,
              start: item.startsAt,
              end: item.endsAt,
              icsHref: `/api/calendar/event?type=live_class&id=${encodeURIComponent(item.id)}`,
            }}
          />
        )}
        {ended &&
          (item.recordingUrl ? (
            <Button size="sm" variant="outline" leftIcon={<Icon.Play className="size-3.5" />} onClick={() => onWatch(item)}>
              {t("batches.classes.watchRecording")}
            </Button>
          ) : (
            <span className="text-xs text-ink-faint">{t("batches.classes.noRecording")}</span>
          ))}
        {ended && item.attended && (
          <Badge tone="success" className="ms-auto">
            <Icon.Check className="size-3" /> {t("batches.classes.attended")}
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
  const t = useT("public");
  const locale = useLocale();
  const now = useNow(serverNow);
  const [watching, setWatching] = useState<LiveClassView | null>(null);
  const margin = JOIN_WINDOW_MINUTES * 60000;
  const upcoming = classes.filter((c) => c.endsAt + margin >= now);
  const past = classes.filter((c) => c.endsAt + margin < now).reverse();

  if (!classes.length) {
    return (
      <EmptyState
        icon={<Icon.Video />}
        title={t("batches.classes.emptyTitle")}
        description={t("batches.classes.emptyDescription")}
        action={emptyAction}
      />
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="upcoming-classes">
        <h2 id="upcoming-classes" className="mb-3 text-base font-semibold text-ink">
          {t.rich("batches.classes.upcoming", { count: upcoming.length, muted: (chunks) => <span className="font-normal text-ink-muted">{chunks}</span> })}
        </h2>
        {upcoming.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((c) => (
              <ClassCard key={c.id} item={c} now={now} isManager={isManager} canJoin={canJoin} onWatch={setWatching} />
            ))}
          </div>
        ) : (
          <p className="rounded-card border border-dashed border-border-strong px-4 py-6 text-center text-sm text-ink-muted">{t("batches.classes.noUpcoming")}</p>
        )}
      </section>
      {past.length > 0 && (
        <section aria-labelledby="past-classes">
          <h2 id="past-classes" className="mb-3 text-base font-semibold text-ink">
            {t.rich("batches.classes.past", { count: past.length, muted: (chunks) => <span className="font-normal text-ink-muted">{chunks}</span> })}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {past.map((c) => (
              <ClassCard key={c.id} item={c} now={now} isManager={isManager} canJoin={canJoin} onWatch={setWatching} />
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!watching} onClose={() => setWatching(null)} title={watching ? t("batches.classes.recordingTitle", { title: watching.title }) : undefined} size="xl">
        {watching?.recordingUrl && (
          <div className="space-y-3">
            <VideoPlayer key={watching.id} src={watching.recordingUrl} title={watching.title} />
            <p className="text-xs text-ink-muted">
              {t("batches.classes.recordedOn", {
                date: formatDayKey(watching.date, "long", locale),
                time: formatClockRange(watching.time, watching.endTime, locale),
                zone: watching.timezone.replace(/_/g, " "),
              })}
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
